import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentId, ProjectScope, RunId, ToolName, EventId, OperationKey, ProjectProjection } from '@context-plane/contracts';
import { MemoryStorage, DurablePersistenceAdapter } from '@context-plane/persistence';
import { ScenarioRunner, snapshotCandidateHash } from '@context-plane/runner';
import { mvp02Scenario } from '@context-plane/scenario';
import { createHarness, type CommandResult, type Credential, type GatewayRunner } from '../src/index.js';

const tokenA = 'test-token-dev-a-0001'; const tokenA2 = 'test-token-dev-a-0002'; const tokenB = 'test-token-dev-b-0001';
const controllerToken = 'test-controller-only-0001';
const credentials: Credential[] = [
  { token: tokenA, personId: 'user_dev_a', agentId: mvp02Scenario.developers[0].agentId, role: 'orders', sessionId: 'session_a' },
  { token: tokenA2, personId: 'user_dev_a', agentId: mvp02Scenario.developers[0].agentId, role: 'orders', sessionId: 'session_a2' },
  { token: tokenB, personId: 'user_dev_b', agentId: mvp02Scenario.developers[1].agentId, role: 'billing', sessionId: 'session_b',
    allowedTools: ['get_project_context', 'propose_change', 'stage_change', 'run_checks', 'apply_change', 'acknowledge_change', 'read_operation', 'send_agent_message'] },
];
const scope = { orgId: 'gateway_test_org', projectId: 'gateway_test_project' } as ProjectScope;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'context-plane-gateway-'));
  let millis = Date.parse('2026-09-26T18:00:00Z');
  const clock = () => new Date(millis);
  const storage = new MemoryStorage(clock); const runner = new ScenarioRunner(root);
  let count = 0;
  const make = (extra: { crashAfterEffect?: () => void; runner?: GatewayRunner; runId?: RunId } = {}) => createHarness({
    persistence: new DurablePersistenceAdapter(storage, { ownerId: `worker_${++count}`, leaseDurationMs: 100 }),
    runner: extra.runner ?? runner, scope, runId: extra.runId ?? 'gateway_test_run' as RunId, credentials, controllerToken, now: clock,
    ...(extra.crashAfterEffect ? { crashAfterEffect: extra.crashAfterEffect } : {}),
  });
  return { root, storage, runner, make, expire: () => { millis += 1000; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}
function command(h: ReturnType<typeof createHarness>, token: string, tool: ToolName, operationKey: string, args: Record<string, unknown>) {
  return h.execute({ token, tool, operationKey, args });
}
async function preparePublication(h: ReturnType<typeof createHarness>) {
  const candidateHash = snapshotCandidateHash('dev-b-published');
  const version = { candidateHash, dependencyRevision: 7, policyEpoch: 1 };
  await command(h, tokenB, 'propose_change', 'b-propose', { ...version, summary: 'Publish registered Billing revision 8' });
  await command(h, tokenB, 'stage_change', 'b-stage', { candidateHash, artifactHashes: mvp02Scenario.snapshots['dev-b-published'].map(a => a.artifactHash) });
  await command(h, tokenB, 'run_checks', 'b-check', { candidateHash, registeredCommands: ['consumer-integration'] });
  return version;
}

test('server identity binding rejects spoofing, wrong scope, tools and prototype payloads', async () => {
  const f = await fixture(); const h = f.make();
  try {
    await assert.rejects(h.context('bad'), /UNAUTHORIZED/);
    assert.notEqual((await h.context(tokenA)).identity.sessionId, (await h.context(tokenA2)).identity.sessionId);
    await assert.rejects(h.execute({ token: tokenA, tool: 'report_progress', operationKey: 'spoof', args: { summary: 'x', evidenceIds: [], agentId: 'other' } }), /INVALID_INPUT/);
    await assert.rejects(h.execute({ token: tokenA, tool: 'get_project_context', operationKey: 'scope', args: {}, scope: { ...scope, projectId: 'foreign' as ProjectScope['projectId'] } }), /SCOPE_FORBIDDEN/);
    await assert.rejects(command(h, tokenB, 'query_demo_orders', 'forbidden', { accessRequestId: 'x', queryName: 'x' }), /TOOL_FORBIDDEN/);
    await assert.rejects(command(h, tokenA, 'report_progress', 'prototype', JSON.parse('{"summary":"x","evidenceIds":[],"__proto__":{}}')), /INVALID_INPUT/);
    await assert.rejects(h.learnFromFailure(tokenA, 'learn'), /UNAUTHORIZED/);
  } finally { await f.cleanup(); }
});

test('reference reads and writes refuse a project already used by the separate context API', async () => {
  const f = await fixture();
  try {
    const persistence = new DurablePersistenceAdapter(f.storage);
    await persistence.appendEvent({ scope, runId: 'api_publication' as RunId,
      eventId: 'api_publication_event' as EventId, type: 'dependency.published',
      actor: { kind: 'system', id: 'system', role: 'system' }, revision: 1,
      cursor: '000001', occurredAt: '2026-09-26T18:00:00Z', payload: { revision: 8 } });
    const h = f.make();
    await assert.rejects(h.context(tokenA), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(h.controllerState(controllerToken), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(h, tokenA, 'get_project_context', 'read-context', {}), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(h, tokenA, 'report_progress', 'collision', { summary: 'x', evidenceIds: [] }), /REFERENCE_PROJECT_IN_USE/);
    assert.equal((await persistence.readEvents(scope)).length, 1);
    assert.equal(await persistence.readReceipt(scope, 'collision' as OperationKey), null);
  } finally { await f.cleanup(); }
});

test('API projection initialization alone reserves the project without inventing reference context', async () => {
  const f = await fixture();
  try {
    const persistence = new DurablePersistenceAdapter(f.storage);
    const initialized: ProjectProjection = {
      scope, revision: 1, eventCursor: '000000', policyEpoch: 1, runs: [], accessRequests: [], timeline: [],
      dependencies: [{ dependencyId: mvp02Scenario.dependency.dependencyId, providerServiceId: 'orders', consumerServiceId: 'billing',
        revision: 8, artifactHash: mvp02Scenario.devBPublication.artifact.artifactHash,
        evidenceIds: [mvp02Scenario.devBPublication.evidence.evidenceId] }], addressedMessages: [],
    };
    await persistence.saveProjection(initialized, 0);
    const h = f.make();
    await assert.rejects(h.context(tokenA), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(h, tokenA, 'report_progress', 'projection-collision', { summary: 'x', evidenceIds: [] }), /REFERENCE_PROJECT_IN_USE/);
    assert.deepEqual(await persistence.readProjection(scope), initialized);
    assert.deepEqual(await persistence.readEvents(scope), []);
    assert.equal(await persistence.readCheckpoint(scope, 'gateway_test_run' as RunId), null);
    assert.equal(await persistence.readReceipt(scope, 'projection-collision' as OperationKey), null);
  } finally { await f.cleanup(); }
});

test('reference projection includes shared fields and another run cannot adopt its project', async () => {
  const f = await fixture();
  try {
    const persistence = new DurablePersistenceAdapter(f.storage); const h = f.make();
    assert.equal((await h.context(tokenA)).dependencyRevision, 7);
    await command(h, tokenA, 'report_progress', 'reference-progress', { summary: 'Reference run only', evidenceIds: [] });
    const projection = await persistence.readProjection(scope);
    assert.ok(projection);
    assert.deepEqual(projection.dependencies, []);
    assert.deepEqual(projection.addressedMessages, []);
    const other = f.make({ runId: 'other_reference_run' as RunId });
    await assert.rejects(other.context(tokenA), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(other, tokenA, 'report_progress', 'other-run', { summary: 'x', evidenceIds: [] }), /REFERENCE_PROJECT_IN_USE/);
    assert.deepEqual(await persistence.readProjection(scope), projection);
    assert.equal((await persistence.readEvents(scope)).length, 1);
  } finally { await f.cleanup(); }
});

test('a later foreign event prevents stale reference context, operation reads and cached command replay', async () => {
  const f = await fixture();
  try {
    const persistence = new DurablePersistenceAdapter(f.storage); const h = f.make();
    const args = { summary: 'Reference run only', evidenceIds: [] };
    await command(h, tokenA, 'report_progress', 'reference-progress', args);
    const projection = await persistence.readProjection(scope);
    await persistence.appendEvent({ scope, runId: 'api_publication' as RunId,
      eventId: 'later_api_publication_event' as EventId, type: 'dependency.published',
      actor: { kind: 'system', id: 'system', role: 'system' }, revision: 1,
      cursor: '000002', occurredAt: '2026-09-26T18:00:01Z', payload: { revision: 8 } });
    await assert.rejects(h.context(tokenA), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(h, tokenA, 'read_operation', 'read-progress', { operationKey: 'reference-progress' }), /REFERENCE_PROJECT_IN_USE/);
    await assert.rejects(command(h, tokenA2, 'report_progress', 'reference-progress', args), /REFERENCE_PROJECT_IN_USE/);
    assert.equal((await persistence.readEvents(scope)).length, 2);
    assert.deepEqual(await persistence.readProjection(scope), projection);
  } finally { await f.cleanup(); }
});

test('retries share one result across sessions and private messages stay scoped', async () => {
  const f = await fixture(); const h = f.make();
  try {
    const args = { recipientAgentId: mvp02Scenario.developers[0].agentId, body: 'Private Dev A note', evidenceIds: [] };
    const one = await command(h, tokenA, 'send_agent_message', 'private', args) as CommandResult;
    const two = await command(h, tokenA2, 'send_agent_message', 'private', args) as CommandResult;
    assert.equal(two.replayed, true); assert.equal(one.eventId, two.eventId);
    assert.equal((await h.context(tokenA)).messages.length, 1);
    assert.equal((await h.context(tokenB)).messages.length, 0);
    await assert.rejects(command(h, tokenB, 'read_operation', 'read-private', { operationKey: 'private' }), /OPERATION_FORBIDDEN/);
    await assert.rejects(command(h, tokenA, 'send_agent_message', 'private', { ...args, body: 'Changed meaning' }), /IDEMPOTENCY_CONFLICT/);
  } finally { await f.cleanup(); }
});

test('crash after publication recovers only the same durable command intent, with one effect', async () => {
  const f = await fixture(); const h = f.make({ crashAfterEffect: () => { throw new Error('SIMULATED_CRASH'); } });
  try {
    const version = await preparePublication(h);
    const args = { ...version, operationKey: 'b-apply' };
    await assert.rejects(command(h, tokenB, 'apply_change', 'b-apply', args), /SIMULATED_CRASH/);
    f.expire(); const restarted = f.make();
    await assert.rejects(command(restarted, tokenB, 'apply_change', 'fresh-key', { ...version, operationKey: 'fresh-key' }), /PUBLICATION_PENDING/);
    await assert.rejects(command(restarted, tokenB, 'propose_change', 'overwrite-pending', { ...version, policyEpoch: 2, summary: 'Cannot overwrite recovery binding' }), /PUBLICATION_PENDING/);
    const recovered = await command(restarted, tokenB, 'apply_change', 'b-apply', args) as CommandResult;
    assert.equal(recovered.result.reconciled, true);
    assert.equal((await restarted.context(tokenA)).dependencyRevision, 8);
    assert.equal((await readdir(join(f.root, 'publications'))).length, 1);
    await assert.rejects(command(restarted, tokenB, 'apply_change', 'after-completion', { ...version, operationKey: 'after-completion' }), /ALREADY_PUBLISHED/);
    await assert.rejects(command(h, tokenA, 'report_progress', 'zombie', { summary: 'stale worker', evidenceIds: [] }), /LEASE_LOST/);
  } finally { await f.cleanup(); }
});

test('causal receipts produce one policy epoch; learned gate rejects fresh work without a new acknowledgement', async () => {
  const f = await fixture(); const h = f.make();
  try {
    const version = await preparePublication(h);
    await command(h, tokenB, 'apply_change', 'b-apply', { ...version, operationKey: 'b-apply' });
    await assert.rejects(command(h, tokenA, 'propose_change', 'relabel-stale', {
      candidateHash: snapshotCandidateHash('stale-candidate'), dependencyRevision: 8, policyEpoch: 1, summary: 'Cannot relabel stale fixture',
    }), /DECLARED_DEPENDENCY_MISMATCH/);
    await h.diagnoseFailure(controllerToken, 'diagnostic');
    const learned = await h.learnFromFailure(controllerToken, 'learn') as CommandResult;
    assert.equal((learned.result.policy as { policyEpoch: number }).policyEpoch, 2);
    const repeated = await h.learnFromFailure(controllerToken, 'learn-again') as CommandResult;
    assert.equal(repeated.result.alreadyActive, true);
    assert.equal((await h.context(tokenA)).policyEpoch, 2);
    await h.diagnoseFailure(controllerToken, 'diagnostic-repeat');
    const repeatedEvidence = await h.learnFromFailure(controllerToken, 'learn-more-receipts') as CommandResult;
    assert.equal(repeatedEvidence.result.alreadyActive, true);
    assert.equal((await h.context(tokenA)).policyEpoch, 2);
    const combined = { candidateHash: snapshotCandidateHash('combined-candidate'), dependencyRevision: 8, policyEpoch: 2 };
    const proposed = await command(h, tokenA, 'propose_change', 'fresh-proposal', { ...combined, summary: 'Fresh request under learned policy' }) as CommandResult;
    assert.equal(proposed.result.allowed, false);
    await assert.rejects(command(h, tokenA, 'stage_change', 'premature-stage', { candidateHash: combined.candidateHash,
      artifactHashes: mvp02Scenario.snapshots['combined-candidate'].map(a => a.artifactHash) }), /CHANGE_REJECTED/);
    await command(h, tokenA, 'send_agent_message', 'addressed-request', { recipientAgentId: mvp02Scenario.developers[1].agentId,
      body: 'Coordinate this exact change', evidenceIds: [] });
    await command(h, tokenB, 'acknowledge_change', 'ack', { candidateHash: combined.candidateHash, acknowledgement: 'patched', evidenceIds: [] });
    const checked = await command(h, tokenA, 'check_change', 'fresh-check', combined) as CommandResult;
    assert.equal(checked.result.allowed, true);
  } finally { await f.cleanup(); }
});

test('runner proof cannot silently change operation identity or check registry', async () => {
  const f = await fixture();
  const badRunner: GatewayRunner = {
    stage: (s, k) => f.runner.stage(s, k), publish: (s, k, hash) => f.runner.publish(s, k, hash), reconcile: k => f.runner.reconcile(k),
    check: async (s, k) => ({ ...await f.runner.check(s, k), operationKey: 'other-operation' as never }),
  };
  const h = f.make({ runner: badRunner });
  try { await assert.rejects(preparePublication(h), /INVALID_RUNNER_PROOF/); }
  finally { await f.cleanup(); }
});
