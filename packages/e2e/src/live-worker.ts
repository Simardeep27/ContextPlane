import assert from 'node:assert/strict';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectScope, RunId, ToolName } from '@context-plane/contracts';
import { roleToolAllowlists } from '@context-plane/contracts';
import { DurablePersistenceAdapter } from '@context-plane/persistence';
import { mvp02Scenario } from '@context-plane/scenario';
import { snapshotCandidateHash } from '@context-plane/runner';
import type { InferenceResult } from '@context-plane/gateway';
import type { WorkerConfiguration } from './worker.js';
import { FileStorage } from './file-storage.js';

// Explicit opt-in, file-backed only. Never loads MongoDB credentials or shared DBs.
assert.ok(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY must be supplied through the environment');
assert.ok(process.env.OPENROUTER_MODEL, 'OPENROUTER_MODEL must explicitly select a tool-capable model');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const id = randomUUID().replaceAll('-', '');
const directory = join(root, '.artifacts', 'worker-live', id);
const scope = { orgId: 'worker_live_isolated', projectId: `e2e_${id}` } as ProjectScope;
const runId = `run_${id}` as RunId;
const tokenA = randomUUID(), tokenB = randomUUID(), controllerToken = randomUUID();
const agentA = mvp02Scenario.developers[0].agentId, agentB = mvp02Scenario.developers[1].agentId;
const persistence = new DurablePersistenceAdapter(new FileStorage(join(directory, 'storage.json')));
const leaseDurationMs = 3000;
let child: ChildProcess; let base = '';
async function start(crash: boolean) {
  child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
    execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { PATH: dirname(process.execPath), OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY! },
  });
  const ready = new Promise<number>((yes, no) => {
    const timer = setTimeout(() => no(new Error('Worker readiness timed out')), 30000);
    child.once('message', (m: any) => { clearTimeout(timer); m.type === 'ready' ? yes(m.port) : no(new Error('Worker startup failed')); });
    child.once('error', () => { clearTimeout(timer); no(new Error('Worker spawn failed')); });
  });
  const config: WorkerConfiguration = { directory, scope, runId, mode: 'file', controllerToken,
    crashOnCombinedPublication: crash, leaseDurationMs, model: process.env.OPENROUTER_MODEL!,
    credentials: [
      { token: tokenA, personId: 'user_dev_a', agentId: agentA, role: 'orders', sessionId: 'live_a' },
      { token: tokenB, personId: 'user_dev_b', agentId: agentB, role: 'billing', sessionId: 'live_b', allowedTools: [...roleToolAllowlists.billing, 'apply_change'] },
    ] };
  child.send(config); base = `http://127.0.0.1:${await ready}`;
}
async function command(token: string, tool: ToolName, operationKey: string, args: Record<string, unknown>) {
  const response = await fetch(`${base}/commands`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, operationKey, args }), signal: AbortSignal.timeout(30000) });
  const value = await response.json() as any;
  assert.equal(response.status, 200, `Domain command failed: ${value.error ?? tool}`); return value;
}
async function job(jobKey: string, task: string, expectCrash = false) {
  return new Promise<void>((yes, no) => {
    const active = child;
    const cleanup = () => { clearTimeout(timer); active.off('message', message); active.off('exit', exited); };
    const message = (m: any) => {
      if (m.type !== 'agent-result' && m.type !== 'agent-error') return;
      cleanup();
      if (m.type === 'agent-error') no(new Error(m.message));
      else if (expectCrash) no(new Error('Expected publication crash did not occur'));
      else if (m.result.status !== 'model_stopped') no(new Error('Model turn budget exhausted'));
      else yes();
    };
    const exited = (_code: number | null, signal: string | null) => {
      cleanup(); expectCrash && signal === 'SIGKILL' ? yes() : no(new Error('Unexpected worker exit'));
    };
    const timer = setTimeout(() => { cleanup(); no(new Error('Agent job timed out')); }, 600000);
    active.on('message', message); active.once('exit', exited);
    active.send({ type: 'agent-job', token: tokenA, jobKey, task, maxTurns: 8 });
  });
}
const version = (snapshot: 'dev-b-published' | 'stale-candidate' | 'combined-candidate', revision: number) => ({
  candidateHash: snapshotCandidateHash(snapshot), dependencyRevision: revision, policyEpoch: 1,
});
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await start(true);
  const b = version('dev-b-published', 7);
  await command(tokenB, 'propose_change', 'b-propose', { ...b, summary: 'Fixture dependency update' });
  await command(tokenB, 'stage_change', 'b-stage', { candidateHash: b.candidateHash, artifactHashes: mvp02Scenario.snapshots['dev-b-published'].map(a => a.artifactHash) });
  await command(tokenB, 'run_checks', 'b-check', { candidateHash: b.candidateHash, registeredCommands: ['consumer-integration'] });
  await command(tokenB, 'apply_change', 'b-publish', { ...b, operationKey: 'b-publish' });
  console.log('LIVE: deterministic dependency fixture published; starting actual OpenRouter worker.');
  const stale = version('stale-candidate', 7);
  await job('stale', `Propose this exact candidate with summary "Stale Orders candidate": ${JSON.stringify(stale)}. Call check_change to observe its stale-revision blocker. Once both results are recorded, stop and report the blocker. Do not repair, stage, or publish in this task.`);
  const events = await persistence.readEvents(scope);
  assert.ok(events.some(e => e.type === 'harness.check_change.finished' && (e.payload as any).result.allowed === false));
  const corrected = version('combined-candidate', 8);
  await job('coordinate', `Propose corrected candidate with summary "Coordinated Orders/Billing": ${JSON.stringify(corrected)}. Then send_agent_message to ${agentB}, body "Acknowledge this exact coordinated revision", evidenceIds []. Once proposal and addressed request exist, stop. The host will perform the Billing acknowledgement separately. Do not stage yet.`);
  await command(tokenB, 'acknowledge_change', 'b-ack', { candidateHash: corrected.candidateHash, acknowledgement: 'patched', evidenceIds: [] });
  const finishTask = `Publish the already-proposed and acknowledged candidate ${JSON.stringify(corrected)}. In order: stage_change with artifactHashes ${JSON.stringify(mvp02Scenario.snapshots['combined-candidate'].map(a => a.artifactHash))}; run_checks with registeredCommands ["consumer-integration"]; apply_change with operationKey "host-assigned". Use previous tool responses to skip already completed steps. After publication is confirmed, stop. Never propose a new candidate or send more messages.`;
  await job('finish', finishTask, true);
  const before = await readdir(join(directory, 'runner', 'publications'));
  assert.equal(before.length, 2);
  console.log('LIVE: SIGKILL after model-requested publication; restarting same job.');
  await delay(leaseDurationMs + 150);
  await start(false);
  await job('finish', finishTask);
  assert.deepEqual(await readdir(join(directory, 'runner', 'publications')), before);
  const all = []; let cursor = '000000';
  for (;;) { const page = await persistence.readEvents(scope, cursor); all.push(...page); if (page.length < 100) break; cursor = page.at(-1)!.cursor; }
  const inferences = all.filter(e => e.type === 'harness.model_turn.finished').map(e => (e.payload as any).result.inference as InferenceResult);
  assert.ok(inferences.length > 0);
  assert.equal(new Set(inferences.map(i => i.generationId)).size, inferences.length);
  const publication = all.filter(e => e.type === 'harness.apply_change.finished' && (e.payload as any).result.proof.candidateHash === corrected.candidateHash);
  assert.equal(publication.length, 1);
  assert.equal((publication[0]!.payload as any).result.reconciled, true);
  assert.equal((await persistence.readCheckpoint(scope, runId))!.status, 'completed');
  const manifest = {
    observedAt: new Date().toISOString(), scope, runId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    storage: 'isolated-file', modelCalls: inferences.length,
    inference: inferences.map(({ content, toolCalls, ...metadata }) => ({ ...metadata, tools: toolCalls.map(t => t.name) })),
    staleBlocked: true, realProcessRestart: true, signal: 'SIGKILL', publicationCount: before.length, correctedPublicationCount: publication.length,
    exactCandidateHash: corrected.candidateHash, reconciled: true,
    limitations: ['Fixed synthetic candidates; deterministic Billing setup and acknowledgement.', 'Local process/file persistence; no hosted worker or shared API/MCP write integration.', 'Ambiguous provider outcome requires operator reconciliation; no exactly-once provider billing guarantee.'],
  };
  const output = JSON.stringify(manifest, null, 2) + '\n';
  for (const secret of [process.env.OPENROUTER_API_KEY!, tokenA, tokenB, controllerToken]) assert.equal(output.includes(secret), false);
  const path = join(directory, 'manifest.json'); await writeFile(path, output, { mode: 0o600 });
  console.log(`LIVE PASS: ${inferences.length} real model calls; stale blocker; SIGKILL recovery; no duplicate publication.\nManifest: ${path}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live worker failed');
  console.error(`Inspect isolated evidence: ${directory}`); process.exitCode = 1;
} finally {
  if (child! && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    await Promise.race([stopped, delay(2000).then(() => child.kill('SIGKILL'))]);
  }
}
