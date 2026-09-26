import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Outbox } from './outbox.mjs';
import { configuration } from './claude.mjs';
import { startHeartbeat } from './heartbeat.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-heartbeat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const box = new Outbox(root, configuration({ CP_SYNC_IDENTITY: 'buddh:heartbeat', CP_SYNC_PERSON: 'Buddhsen',
    CP_SYNC_INSTANCE: '411b80e3-8680-4ee7-8f25-691a24e90219', CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/27' }, 'test'));
  const reports = [];
  const deliver = async box => { reports.push(...box.read().pending); await box.mutate(s => { s.pending = []; }); };
  return { box, reports, deliver };
}
const start = { kind: 'SessionStart', key: 'start', summary: 'Observed session start' };
const pulse = key => ({ kind: 'Heartbeat', key, summary: 'Process alive; outcome unverified' });

test('heartbeat preserves actual activity and failure status; stopped/ended sessions stay stopped', async t => {
  const { box, deliver } = fixture(t);
  assert.equal(await box.enqueue(pulse('uncovered')), null);
  await box.enqueue(start); await deliver(box);
  const activity = box.read().activity;
  await box.enqueue(pulse('active'));
  const entry = box.read().pending[0];
  assert.equal(JSON.parse(entry.message.body).type, 'heartbeat');
  assert.equal(entry.surface.content.currentTask, start.summary);
  assert.equal(entry.surface.content.lastActivityAt, activity.at);
  assert.equal(entry.surface.content.heartbeatIntervalSeconds, 60);
  assert.equal(entry.surface.content.outcomeVerified, false);
  await deliver(box);
  await box.enqueue({ kind: 'PostToolUseFailure', key: 'failure', summary: 'Tool failed' }); await deliver(box);
  await box.enqueue(pulse('blocked'));
  assert.equal(box.read().pending[0].surface.content.status, 'blocked'); await deliver(box);
  await box.enqueue({ kind: 'Stop', key: 'stop', summary: 'Turn stopped' }); await deliver(box);
  assert.equal(await box.enqueue(pulse('idle')), null);
  await box.enqueue({ kind: 'PostToolUse', key: 'resume', summary: 'Tool completed' }); await deliver(box);
  assert.ok(await box.enqueue(pulse('resumed'))); await deliver(box);
  await box.enqueue({ kind: 'SessionEnd', key: 'end', summary: 'Ended' }); await deliver(box);
  assert.equal(await box.enqueue(pulse('ended')), null);
});

test('60-second timer retries exact pending payload, does not grow outage backlog, and stops on exit', async t => {
  const { box, deliver, reports } = fixture(t);
  await box.enqueue(start); await deliver(box);
  let tick, alive = true, fail = true, errors = 0, cancelled = false;
  const stop = startHeartbeat({ boxes: () => [box], isAlive: () => alive,
    deliver: async b => { if (fail) throw Error('offline'); await deliver(b); }, onError: () => errors++,
    schedule: (fn, ms) => { assert.equal(ms, 60_000); tick = fn; return 42; },
    cancel: id => { assert.equal(id, 42); cancelled = true; } });
  await tick(); const original = box.read().pending[0];
  await tick(); await tick();
  assert.equal(errors, 3); assert.deepEqual(box.read().pending, [original]);
  fail = false; await tick();
  assert.deepEqual(reports[1], original); assert.equal(box.read().pending.length, 0);
  alive = false; const count = reports.length; await tick(); assert.equal(reports.length, count);
  await stop(); alive = true; await tick(); assert.equal(reports.length, count); assert.equal(cancelled, true);
});

test('overlapping ticks are skipped and shutdown drains an in-flight delivery', async t => {
  const { box, deliver } = fixture(t); await box.enqueue(start); await deliver(box);
  let tick, release, deliveries = 0;
  const stop = startHeartbeat({ boxes: () => [box], isAlive: () => true, onError: () => assert.fail('unexpected error'),
    deliver: async b => { deliveries++; await new Promise(r => { release = r; }); await deliver(b); },
    schedule: fn => { tick = fn; return 1; }, cancel: () => {} });
  const first = tick();
  while (!release) await new Promise(r => setImmediate(r));
  await tick(); assert.equal(deliveries, 1);
  let stopped = false; const closing = stop().then(() => { stopped = true; });
  await new Promise(r => setImmediate(r)); assert.equal(stopped, false);
  release(); await first; await closing; assert.equal(stopped, true);
  await tick(); assert.equal(deliveries, 1);
});

test('pending native reports and stopped activity cannot be overwritten by a heartbeat', async t => {
  const { box, deliver } = fixture(t); await box.enqueue(start);
  assert.equal(await box.enqueue(pulse('pending')), null); await deliver(box);
  await Promise.all([box.enqueue({ kind: 'Stop', key: 'stop', summary: 'Turn stopped' }), box.enqueue(pulse('race'))]);
  assert.equal(box.read().pending.at(-1).surface.content.status, 'stopped');
  await deliver(box); assert.equal(await box.enqueue(pulse('after-stop')), null);
});
