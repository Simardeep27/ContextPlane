import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProjectScope, RunId, OperationKey } from '@context-plane/contracts';
import { MemoryStorage, DurablePersistenceAdapter } from '@context-plane/persistence';
import { ScenarioRunner } from '@context-plane/runner';
import { mvp02Scenario } from '@context-plane/scenario';
import { createHarness, runAgent, OpenRouterProvider, parseCompletion, type InferenceProvider, type InferenceResult } from '../src/index.js';

const scope = { orgId: 'worker_test', projectId: 'isolated' } as ProjectScope;
const runId = 'worker_run' as RunId;
const token = 'worker-test-token-0001';
const credentials = [{ token, personId: 'person-a', agentId: mvp02Scenario.developers[0].agentId, role: 'orders' as const, sessionId: 'worker-session' }];
function response(calls: InferenceResult['toolCalls'] = []): InferenceResult {
  return { provider: 'openrouter', generationId: 'test-generation', requestedModel: 'test/requested', returnedModel: 'test/actual',
    promptTokens: 5, completionTokens: 3, totalTokens: 8, latencyMs: 2, finishReason: calls.length ? 'tool_calls' : 'stop', content: null, toolCalls: calls };
}
function provider(complete: InferenceProvider['complete'], reconcile: InferenceProvider['reconcile'] = async () => null): InferenceProvider {
  return { model: 'test/requested', complete, reconcile };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cp-worker-'));
  let now = Date.now();
  const storage = new MemoryStorage(() => new Date(now));
  const runner = new ScenarioRunner(root);
  const persistence = () => new DurablePersistenceAdapter(storage, { leaseDurationMs: 100 });
  const make = (options: Partial<Parameters<typeof createHarness>[0]> = {}) => createHarness({ scope, runId, credentials, runner,
    persistence: persistence(), now: () => new Date(now), heartbeatMs: 10, ...options });
  return { root, make, persistence, expire: () => { now += 1000; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('model receives scoped context and registered role tools; restart replays inference and effects', async () => {
  const f = await fixture(); let calls = 0;
  try {
    const h = f.make();
    await h.execute({ token, operationKey: 'private-note', tool: 'send_agent_message', args: {
      recipientAgentId: credentials[0]!.agentId, body: 'own context', evidenceIds: [] } });
    const p = provider(async (_key, request) => {
      calls++;
      assert.equal((request.context as any).scope.projectId, scope.projectId);
      assert.equal((request.context as any).messages[0].body, 'own context');
      assert.ok(request.tools.some(t => t.name === 'report_progress'));
      assert.ok(!request.tools.some(t => t.name === 'acknowledge_change'));
      return calls === 1 ? response([{ id: 'call-1', name: 'report_progress', arguments: { summary: 'Observed test', evidenceIds: [] } }]) : response();
    });
    const first = await runAgent({ harness: h, token, jobKey: 'job', task: 'report once', provider: p });
    assert.equal(first.status, 'model_stopped'); assert.equal(calls, 2);
    const before = await f.persistence().readEvents(scope);
    f.expire();
    await runAgent({ harness: f.make(), token, jobKey: 'job', task: 'report once', provider: p });
    assert.equal(calls, 2);
    assert.deepEqual(await f.persistence().readEvents(scope), before);
    await assert.rejects(runAgent({ harness: f.make(), token, jobKey: 'job', task: 'changed task', provider: p }), /IDEMPOTENCY_CONFLICT/);
    assert.equal(before.filter(e => e.type === 'harness.report_progress.finished').length, 1);
    assert.equal((before.find(e => e.type === 'harness.model_turn.finished')!.payload as any).result.inference.returnedModel, 'test/actual');
  } finally { await f.cleanup(); }
});

test('unknown tools and role overrides are rejected durably, never executed', async () => {
  const f = await fixture();
  try {
    const h = f.make({ credentials: [{ ...credentials[0]!, allowedTools: ['get_project_context', 'acknowledge_change'] }] });
    await h.modelTurn(token, 'model', 'Check tools', provider(async (_key, request) => {
      assert.deepEqual(request.tools.map(t => t.name), ['get_project_context']); return response();
    }));
    const one = await h.executeModelTool(token, 'forbidden', 'acknowledge_change', {});
    assert.equal((one as any).error, 'TOOL_FORBIDDEN');
    assert.equal((await h.executeModelTool(token, 'unknown', 'shell', { command: 'bad' }) as any).error, 'TOOL_FORBIDDEN');
    assert.equal((await h.executeModelTool(token, 'invalid', 'report_progress', { summary: 'x', evidenceIds: [], agentId: 'spoof' }) as any).error, 'TOOL_FORBIDDEN');
    const before = await f.persistence().readEvents(scope);
    await h.executeModelTool(token, 'forbidden', 'acknowledge_change', {});
    assert.deepEqual(await f.persistence().readEvents(scope), before);
  } finally { await f.cleanup(); }
});

test('captured response reconciles after commit loss; unknown inference never repeats', async () => {
  const f = await fixture(); let calls = 0; let saved: InferenceResult | null = null;
  const p = provider(async () => { calls++; saved = response(); throw new Error('CRASH_AFTER_RESPONSE'); }, async () => saved);
  try {
    await assert.rejects(f.make().modelTurn(token, 'turn', 'Task', p), /CRASH_AFTER_RESPONSE/);
    assert.equal((await f.persistence().readReceipt(scope, 'turn' as OperationKey))!.status, 'started');
    f.expire();
    await f.make().modelTurn(token, 'turn', 'Task', p);
    assert.equal(calls, 1);
    f.expire();
    const unknown = provider(async () => { calls++; throw new Error('LOST'); });
    await assert.rejects(f.make().modelTurn(token, 'unknown', 'Task', unknown), /LOST/);
    f.expire();
    await assert.rejects(f.make().modelTurn(token, 'unknown', 'Task', unknown), /INFERENCE_OUTCOME_UNKNOWN/);
    assert.equal(calls, 2);
  } finally { await f.cleanup(); }
});

test('stale model generation cannot commit after another worker reclaims', async () => {
  const f = await fixture();
  let resolve!: (v: InferenceResult) => void; let began!: () => void;
  const started = new Promise<void>(r => { began = r; });
  try {
    const old = f.make().modelTurn(token, 'slow', 'Task', provider(async () => { began(); return new Promise(r => { resolve = r; }); }));
    await started; f.expire();
    await f.make().execute({ token, operationKey: 'reclaimed', tool: 'report_progress', args: { summary: 'reclaimed', evidenceIds: [] } });
    resolve(response()); await assert.rejects(old, /LEASE_LOST/);
    assert.equal((await f.persistence().readReceipt(scope, 'slow' as OperationKey))!.status, 'started');
  } finally { await f.cleanup(); }
});

test('provider captures returned usage, strips reasoning, and does not retry uncertain HTTP effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cp-openrouter-')); let calls = 0;
  const request = { model: 'test/requested', task: 'Task', context: {}, history: [], tools: [] };
  try {
    const raw = { id: 'generation-real-shape', model: 'actual/model', usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      choices: [{ finish_reason: 'stop', message: { content: 'done', reasoning: 'PRIVATE_NOT_STORED' } }] };
    const p = new OpenRouterProvider({ apiKey: 'SECRET_NOT_STORED', model: request.model, journalDirectory: root,
      fetch: async (url, init) => { calls++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
        const body = JSON.parse(init!.body as string); assert.equal(body.reasoning.exclude, true);
        return new Response(JSON.stringify(raw)); } });
    const result = await p.complete('turn', request);
    assert.equal(result.returnedModel, 'actual/model'); assert.equal(result.totalTokens, 14);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.deepEqual(await p.complete('turn', request), result); assert.equal(calls, 1);
    await assert.rejects(p.complete('turn', { ...request, task: 'changed' }), /IDEMPOTENCY_CONFLICT/);
    const failing = new OpenRouterProvider({ apiKey: 'secret', model: request.model, journalDirectory: root,
      fetch: async () => { calls++; throw new Error('secret-bearing error'); } });
    await assert.rejects(failing.complete('unknown', request), /^Error: OPENROUTER_OUTCOME_UNKNOWN$/);
    await assert.rejects(failing.complete('unknown', request), /INFERENCE_OUTCOME_UNKNOWN/);
    assert.equal(calls, 2); assert.equal((await readdir(root)).length, 2);
    assert.throws(() => parseCompletion({ ...raw, usage: {} }, request.model, 1), /INVALID_INFERENCE_USAGE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
