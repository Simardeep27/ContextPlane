import assert from 'node:assert/strict';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { roleToolAllowlists, type OrgId, type ProjectId, type RunId, type ToolName } from '@context-plane/contracts';
import { applyCoordinationRule, evaluateCoordinationRule } from '@context-plane/core';
import { type CommandResult, type HarnessState } from '@context-plane/gateway';
import { snapshotCandidateHash } from '@context-plane/runner';
import { mvp02Scenario, type ScenarioSnapshotId } from '@context-plane/scenario';
import type { WorkerConfiguration } from './worker.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mode = process.argv.includes('--atlas') ? 'atlas' : 'file';
const id = randomUUID().replaceAll('-', '');
const directory = join(root, '.artifacts', 'e2e', id);
const tokenA = randomUUID(), tokenA2 = randomUUID(), tokenB = randomUUID(), controllerToken = randomUUID();
const agentA = mvp02Scenario.developers[0].agentId, agentB = mvp02Scenario.developers[1].agentId;
const scope = { orgId: 'org_shivraj_experiments' as OrgId, projectId: `e2e_${id}` as ProjectId };
const runId = `run_${id}` as RunId;
const leaseDurationMs = mode === 'atlas' ? 15000 : 1500;
let worker: ChildProcess | undefined;
let base = '';
const commands: CommandResult[] = [];
const negatives: string[] = [];

function atlasUri(): string | undefined {
  if (mode !== 'atlas') return undefined;
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  for (const service of ['context-plane-personal/MONGODB_URI', 'context-plane/MONGODB_URI', 'nyc-harness-tech-lab/MONGODB_URI']) {
    try {
      return execFileSync('/usr/bin/security', ['find-generic-password', '-a', userInfo().username,
        '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* Try the next explicitly configured secret location without logging it. */ }
  }
  throw new Error('Atlas mode needs MONGODB_URI in the environment or Keychain. Use the hidden store-team-secret.sh prompt.');
}

async function start(crashOnCombinedPublication: boolean, uri?: string): Promise<void> {
  const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
    execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { PATH: dirname(process.execPath), ...(uri ? { MONGODB_URI: uri } : {}) },
  });
  worker = child;
  const ready = new Promise<number>((resolveReady, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker startup timed out')); }, 30000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Worker startup failed')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Worker exited before readiness')); });
    child.once('message', (message: { type: string; port?: number }) => {
      clearTimeout(timeout);
      if (message.type === 'ready' && message.port) resolveReady(message.port);
      else reject(new Error('Worker startup failed; verify Atlas credential and scoped access privately.'));
    });
  });
  const config: WorkerConfiguration = { directory, mode, scope, runId, controllerToken, crashOnCombinedPublication, leaseDurationMs,
    credentials: [
      { token: tokenA, personId: 'user_dev_a', agentId: agentA, role: 'orders', sessionId: 'session_a_1' },
      { token: tokenA2, personId: 'user_dev_a', agentId: agentA, role: 'orders', sessionId: 'session_a_2' },
      // Fixed reference-service permission: Billing can publish its OWN registered change.
      { token: tokenB, personId: 'user_dev_b', agentId: agentB, role: 'billing', sessionId: 'session_b_1', allowedTools: [...roleToolAllowlists.billing, 'apply_change'] },
    ],
  };
  child.send(config);
  base = `http://127.0.0.1:${await ready}`;
}

async function request(token: string, path: string, body?: unknown, expected = 200): Promise<Record<string, any>> {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const data = await response.json() as Record<string, any>;
  assert.equal(response.status, expected, `Unexpected HTTP status: ${data.error ?? path}`);
  return data;
}
async function command(token: string, tool: ToolName, operationKey: string, args: Record<string, unknown>, expected = 200) {
  const result = await request(token, '/commands', { tool, operationKey, args }, expected);
  if (expected === 200 && result.eventId) commands.push(result as CommandResult);
  return result;
}
async function rejected(name: string, token: string, tool: ToolName, args: Record<string, unknown>, status: number) {
  const result = await command(token, tool, `reject-${name}`, args, status);
  assert.equal(typeof result.error, 'string'); negatives.push(name);
}
const version = (snapshot: ScenarioSnapshotId, dependencyRevision: number, policyEpoch = 1) => ({
  candidateHash: snapshotCandidateHash(snapshot), dependencyRevision, policyEpoch,
});
async function stageAndCheck(token: string, snapshot: ScenarioSnapshotId) {
  const candidateHash = snapshotCandidateHash(snapshot);
  await command(token, 'stage_change', `stage-${snapshot}`, { candidateHash, artifactHashes: mvp02Scenario.snapshots[snapshot].map(a => a.artifactHash) });
  const checked = await command(token, 'run_checks', `check-${snapshot}`, { candidateHash, registeredCommands: ['consumer-integration'] });
  assert.equal(checked.result.checkResult.passed, true);
  assert.equal(checked.result.proof.exitCode, 0);
  return checked;
}

async function main() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const uri = atlasUri();
  if (uri) {
    const expectedHost = process.env.ATLAS_EXPECTED_HOST;
    assert.ok(expectedHost && /^[a-z0-9.-]+\.mongodb\.net$/.test(expectedHost), 'Set the verified nonsecret ATLAS_EXPECTED_HOST before an Atlas run; no connection attempted.');
    let correctHost = false;
    try { const parsed = new URL(uri); correctHost = parsed.protocol === 'mongodb+srv:' && parsed.hostname === expectedHost; } catch { /* Never print the parsed credential. */ }
    assert.equal(correctHost, true, 'Atlas URI does not match the explicitly selected cluster host; no connection attempted.');
  }
  await start(true, uri);
  console.log(`E2E: ${mode} persistence ready; unique project ${scope.projectId}`);
  await request('invalid-token', '/context', undefined, 401); negatives.push('invalid-token');
  await request(tokenA, '/commands', { tool: 'report_progress', operationKey: 'wrong-scope', args: { summary: 'x', evidenceIds: [] }, scope: { ...scope, projectId: 'other_project' } }, 403);
  negatives.push('wrong-scope');
  await rejected('tool-denied', tokenA, 'acknowledge_change', { candidateHash: snapshotCandidateHash('combined-candidate'), acknowledgement: 'patched', evidenceIds: [] }, 403);
  await rejected('unknown-change', tokenA, 'propose_change', { candidateHash: 'unknown', dependencyRevision: 7, policyEpoch: 1, summary: 'invalid' }, 400);
  const context1 = await request(tokenA, '/context');
  const context2 = await request(tokenA2, '/context');
  assert.equal(context1.identity.agentId, context2.identity.agentId);
  assert.notEqual(context1.identity.sessionId, context2.identity.sessionId);
  await command(tokenB, 'propose_change', 'propose-dev-b', { ...version('dev-b-published', 7), summary: 'Billing rounds cents before conversion.' });
  await stageAndCheck(tokenB, 'dev-b-published');
  await command(tokenB, 'apply_change', 'publish-dev-b', { ...version('dev-b-published', 7), operationKey: 'publish-dev-b' });
  assert.equal((await request(tokenA, '/context')).dependencyRevision, 8);
  const stale = await command(tokenA, 'propose_change', 'propose-stale', { ...version('stale-candidate', 7), summary: 'Orders changes cents to dollars on old dependency.' });
  assert.equal(stale.result.allowed, false);
  await rejected('stale-stage', tokenA, 'stage_change', { candidateHash: snapshotCandidateHash('stale-candidate'), artifactHashes: mvp02Scenario.snapshots['stale-candidate'].map(a => a.artifactHash) }, 409);
  const diagnostic = await request(controllerToken, '/controller/diagnose', { operationKey: 'diagnose-contract' });
  commands.push(diagnostic as CommandResult);
  const diagnosis = diagnostic.result.diagnosis;
  assert.deepEqual([diagnosis.baseline.checkResult.passed, diagnosis.changed.checkResult.passed, diagnosis.reverted.checkResult.passed], [true, false, true]);
  console.log('E2E: real baseline passed, changed consumer failed, revert passed; stale publication blocked.');
  await command(tokenA, 'propose_change', 'propose-combined', { ...version('combined-candidate', 8), summary: 'Coordinate Orders dollars with Billing.' });
  await rejected('unaddressed-ack', tokenB, 'acknowledge_change', { candidateHash: snapshotCandidateHash('combined-candidate'), acknowledgement: 'patched', evidenceIds: [] }, 409);
  await command(tokenA, 'send_agent_message', 'request-billing', { recipientAgentId: agentB, body: 'Update Billing for this exact Orders change.', evidenceIds: diagnostic.result.evidenceIds });
  assert.equal((await request(tokenB, '/context')).messages.length, 1);
  await command(tokenB, 'acknowledge_change', 'ack-billing', { candidateHash: snapshotCandidateHash('combined-candidate'), acknowledgement: 'patched', evidenceIds: diagnostic.result.evidenceIds });
  const combinedCheck = await stageAndCheck(tokenA, 'combined-candidate');
  const publishArgs = { ...version('combined-candidate', 8), operationKey: 'publish-combined' };
  const exited = once(worker!, 'exit');
  await assert.rejects(command(tokenA, 'apply_change', 'publish-combined', publishArgs), /fetch failed|socket|network/i);
  const [, signal] = await exited;
  assert.equal(signal, 'SIGKILL');
  const before = await readdir(join(directory, 'runner', 'publications'));
  assert.equal(before.length, 2);
  console.log('E2E: killed worker after publication and before final receipt; restarting.');
  await delay(leaseDurationMs + 150);
  await start(false, uri);
  const recovered = await command(tokenA2, 'apply_change', 'publish-combined', publishArgs);
  assert.equal(recovered.result.reconciled, true);
  assert.equal(recovered.result.proof.candidateHash, combinedCheck.result.checkResult.version.candidateHash);
  const replay = await command(tokenA, 'apply_change', 'publish-combined', publishArgs);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await readdir(join(directory, 'runner', 'publications')), before);
  await rejected('idempotency-conflict', tokenA, 'apply_change', { ...publishArgs, operationKey: 'different' }, 400);
  // Same command key, altered input must conflict even after a process restart.
  await command(tokenA, 'apply_change', 'publish-combined', { ...publishArgs, dependencyRevision: 7 }, 409); negatives.push('changed-retry-payload');
  const learned = await request(controllerToken, '/controller/learn', { operationKey: 'learn-contract' });
  commands.push(learned as CommandResult);
  assert.equal(learned.result.evaluation.passed, true);
  assert.equal(learned.result.policy.policyEpoch, 2);
  assert.equal((await request(tokenA2, '/context')).activePolicy.policyEpoch, 2);
  await command(tokenA2, 'propose_change', 'followup-proposal', { ...version('combined-candidate', 8, 2), summary: 'Follow-up under the newly active rule.' });
  const followupBlocked = await command(tokenA2, 'check_change', 'followup-missing-ack', version('combined-candidate', 8, 2));
  assert.equal(followupBlocked.result.policyDecision.decision, 'block');
  await command(tokenA2, 'send_agent_message', 'followup-request', { recipientAgentId: agentB, body: 'Verify this version under the new rule.', evidenceIds: [] });
  await command(tokenB, 'acknowledge_change', 'followup-ack', { candidateHash: snapshotCandidateHash('combined-candidate'), acknowledgement: 'no-change', evidenceIds: combinedCheck.result.evidenceIds });
  const followupAllowed = await command(tokenA2, 'check_change', 'followup-current-ack', version('combined-candidate', 8, 2));
  assert.equal(followupAllowed.result.policyDecision.decision, 'allow');
  const learnedRule = learned.result.policy.rule;
  const heldOut = { caseId: 'heldout-revision-19', changeKind: 'unit_change' as const, dependencyRevision: 19, candidateDependencyRevision: 19,
    requiredAgentIds: [agentB], acknowledgements: [], observedFailure: null };
  assert.equal(applyCoordinationRule(learnedRule, heldOut).decision, 'block');
  assert.equal(applyCoordinationRule(learnedRule, { ...heldOut, acknowledgements: [{ agentId: agentB, dependencyRevision: 19, outcome: 'patched' }] }).decision, 'allow');
  assert.equal(evaluateCoordinationRule({ ...learnedRule, requireAcknowledgements: false }, mvp02Scenario.policyCases).passed, false);
  assert.equal(evaluateCoordinationRule({ ...learnedRule, requiredAgentIds: [agentB, 'agent_unrelated'] }, mvp02Scenario.policyCases).passed, false);
  const final = await request(controllerToken, '/controller/state') as HarnessState;
  assert.equal(final.publications.includes(snapshotCandidateHash('stale-candidate')), false);
  assert.equal(final.publications.length, 2);
  const staticEvaluation = evaluateCoordinationRule({ kind: 'unit_change', requiredAgentIds: [agentB], requireCurrentDependencyRevision: true, requireAcknowledgements: true }, mvp02Scenario.policyCases);
  const manifest = {
    schemaVersion: 1, observedAt: new Date().toISOString(), mode, database: mode === 'atlas' ? 'shivraj_experiments' : null,
    scope, runId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    transport: 'loopback-http-json', modelCalls: 0, agentClients: 'two scripted identities, three sessions',
    realProcessRestart: true, restartSignal: signal, publicationCount: final.publications.length,
    stalePublished: false, testedHash: combinedCheck.result.checkResult.version.candidateHash, publishedHash: recovered.result.proof.candidateHash,
    causalChecks: diagnosis, commands: commands.map(({ operationKey, tool, eventId, receipt, replayed }) => ({ operationKey, tool, eventId, receipt, replayed })),
    rejectedCases: negatives, policy: learned.result.policy, evaluation: learned.result.evaluation,
    equivalentStaticEvaluation: staticEvaluation, heldOut: { revision: 19, missingAck: 'block', currentAck: 'allow' },
    limitations: ['Fixed synthetic changes and deterministic rule derivation.', 'No measured company productivity uplift.', 'HTTP clients are not Codex or Claude MCP clients.', 'File mode is a single-process test store, not MongoDB proof.', 'Runner has no OS/network isolation.'],
  };
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  for (const secret of [tokenA, tokenA2, tokenB, controllerToken, ...(uri ? [uri] : [])]) assert.equal(serialized.includes(secret), false);
  const path = join(directory, 'manifest.json'); await writeFile(path, serialized, { mode: 0o600 });
  console.log(`E2E PASS: ${negatives.length} rejected cases; 2 publications; exact hash; real restart; policy 5/5; equivalent static policy 5/5.\nManifest: ${path}`);
}

try { await main(); }
catch (error) {
  // All request/driver failures are sanitized above; no secret-bearing raw Mongo error is printed.
  console.error(error instanceof Error ? error.message : 'E2E failed'); process.exitCode = 1;
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const stopped = once(worker, 'exit'); worker.kill('SIGTERM');
    await Promise.race([stopped, delay(2000).then(() => worker?.kill('SIGKILL'))]);
  }
}
