import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Outbox, recoverLocks } from './outbox.mjs';
import { configuration, observation } from './claude.mjs';
const env = { CP_SYNC_IDENTITY: 'shivraj:sync', CP_SYNC_PERSON: 'Shivraj', CP_SYNC_INSTANCE: '411b80e3-8680-4ee7-8f25-691a24e90219', CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/27' };
const cfg = configuration(env, 'test-session');
function setup(t, budget) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sync-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Outbox(root, cfg, budget);
}
function server() {
  const messages = new Map(); let surface; let fail; let registered = false;
  return { messages, get surface() { return surface; }, set surface(v) { surface = v; }, set fail(v) { fail = v; },
    call: async (name, args) => {
      if (fail === name) throw Error('offline');
      if (name === 'get_context') return { context: registered ? { surfaces: surface ? [surface] : [] } : null };
      if (name === 'register_agent') { registered = true; return {}; }
      if (name === 'receive_inbox') return { messages: [] };
      if (name === 'send_message') {
        if (messages.has(args.message_id)) assert.deepEqual(messages.get(args.message_id), args);
        messages.set(args.message_id, structuredClone(args)); return {};
      }
      if (name === 'publish_surface') { surface = { ownerIdentity: args.identity, surfaceName: args.surface_name, content: args.content }; return surface; }
      throw Error('unexpected tool');
    } };
}
const start = { kind: 'SessionStart', key: 'start', summary: 'Client started; outcome unverified' };
test('offline enqueue, restart, partial delivery and lost acknowledgement preserve exact payload', async t => {
  const box = setup(t); const id = await box.enqueue(start); const original = box.read().pending[0]; const remote = server();
  remote.fail = 'get_context'; await assert.rejects(box.flush(remote.call)); assert.equal(box.read().pending.length, 1);
  remote.fail = 'publish_surface'; await assert.rejects(box.flush(remote.call)); assert.equal(remote.messages.size, 1);
  const restarted = new Outbox(path.dirname(box.dir), cfg); assert.deepEqual(restarted.read().pending[0], original);
  remote.fail = undefined;
  let lose = true;
  await assert.rejects(restarted.flush(async (name, args) => {
    const result = await remote.call(name, args);
    if (name === 'publish_surface' && lose) { lose = false; throw Error('ack lost'); } return result;
  }));
  await restarted.flush(remote.call); assert.equal(remote.messages.size, 1); assert.equal(remote.surface.content.lastEventId, id);
  assert.equal(restarted.read().pending.length, 0); await restarted.enqueue(start); assert.equal(restarted.read().pending.length, 0);
});
test('bounded outbox refuses new reports without evicting unsent reports; files private', async t => {
  const box = setup(t, { pending: 1, seen: 2, bytes: 10000 }); await box.enqueue(start);
  await assert.rejects(box.enqueue({ ...start, key: 'second' }), /OUTBOX_FULL/);
  assert.equal(box.read().pending.length, 1); assert.equal(box.read().sequence, 1);
  assert.equal(fs.statSync(box.file).mode & 0o777, 0o600); assert.equal(fs.statSync(box.dir).mode & 0o777, 0o700);
});
test('concurrent captures serialize, deduplicate and publish in sequence', async t => {
  const box = setup(t); await Promise.all(Array.from({ length: 20 }, (_, i) => box.enqueue({ ...start, key: String(i % 10) })));
  assert.equal(box.read().pending.length, 10); const remote = server(); await box.flush(remote.call);
  assert.equal(remote.messages.size, 10); assert.equal(remote.surface.content.sequence, 10);
});
test('late tool events retain history without reopening ended session', async t => {
  const box = setup(t); const remote = server(); await box.enqueue(start);
  await box.enqueue({ kind: 'SessionEnd', key: 'end', summary: 'Ended' });
  await box.enqueue({ kind: 'PostToolUse', key: 'late', summary: 'Late' }); await box.flush(remote.call);
  assert.equal(remote.surface.content.sequence, 2); assert.equal(remote.surface.content.status, 'stopped');
  assert.equal(JSON.parse([...remote.messages.values()][2].body).stale, true);
  assert.equal(JSON.parse([...remote.messages.values()][1].body).type, 'work_finished');
});
test('stale queue cannot roll back newer snapshot; foreign writer fails closed', async t => {
  const box = setup(t); const remote = server(); await box.enqueue(start);
  await remote.call('register_agent', {});
  remote.surface = { ownerIdentity: cfg.identity, surfaceName: 'work-status', content: { instanceId: cfg.instanceId, sequence: 100 } };
  await box.flush(remote.call); assert.equal(remote.surface.content.sequence, 100);
  await box.enqueue({ ...start, key: 'new' }); remote.surface.content.instanceId = 'other';
  await assert.rejects(box.flush(remote.call), /SURFACE_WRITER_CONFLICT/); assert.equal(box.read().pending.length, 1);
});
test('session and client instance identity separation; raw input never serialized', async t => {
  const box = setup(t);
  assert.notEqual(configuration(env, 'other-session').identity, cfg.identity);
  assert.notEqual(configuration({ ...env, CP_SYNC_INSTANCE: '411b80e3-8680-4ee7-8f25-691a24e90218' }, 'test-session').identity, cfg.identity);
  const input = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tool-1', session_id: 'session',
    tool_input: { command: 'secret token' }, tool_response: 'secret transcript', transcript_path: '/secret/path', reasoning: 'private reasoning' };
  await box.enqueue(observation(input)); const stored = fs.readFileSync(box.file, 'utf8');
  for (const value of ['secret', 'transcript', 'reasoning', '/secret/path', 'tool-1']) assert.equal(stored.includes(value), false);
  assert.equal(observation({ ...input, tool_name: 'UntrustedSecretName' }), null);
  assert.throws(() => configuration({ ...env, CP_SYNC_TASK: 'https://github.com/x/y/issues/1?token=secret' }, 's'));
});
test('crashed delivery lock leaves queued report; explicit recovery rejects live owner', async t => {
  const box = setup(t); await box.enqueue(start); const dir = path.join(box.dir, 'delivery.lock'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  await assert.rejects(box.flush(server().call), /OUTBOX_BUSY/); assert.throws(() => recoverLocks(box.dir), /LOCK_OWNER_ALIVE/);
  assert.equal(box.read().pending.length, 1);
  fs.writeFileSync(path.join(dir, 'pid'), '2147483647'); recoverLocks(box.dir);
  await box.flush(server().call); assert.equal(box.read().pending.length, 0);
});
test('readback mismatch never marks synchronized', async t => {
  const box = setup(t); await box.enqueue(start); const remote = server();
  await assert.rejects(box.flush(async (name, args) => {
    const result = await remote.call(name, args);
    if (name === 'publish_surface') remote.surface.content = { ...args.content, status: 'done' };
    return result;
  }), /SURFACE_READBACK_FAILED/); assert.equal(box.read().pending.length, 1);
});

test('SIGKILL after durable enqueue retains report across a fresh process and lock recovery', async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const box = setup(t);
  const source = `import {Outbox} from ${JSON.stringify(new URL('./outbox.mjs', import.meta.url).href)};
    const box=new Outbox(${JSON.stringify(path.dirname(box.dir))},${JSON.stringify(cfg)});
    await box.enqueue(${JSON.stringify(start)});
    await box.flush(async()=>{process.stdout.write('durable\\n');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const restarted = new Outbox(path.dirname(box.dir), cfg); assert.equal(restarted.read().pending.length, 1);
  recoverLocks(restarted.dir); const remote = server(); await restarted.flush(remote.call);
  assert.equal(remote.messages.size, 1); assert.equal(restarted.read().pending.length, 0);
});

test('spool capacity bounds session directories and remembered keys', async t => {
  const box = setup(t, { pending: 256, seen: 1, bytes: 10000 });
  await box.enqueue(start); await box.flush(server().call);
  await assert.rejects(box.enqueue({ ...start, key: 'second' }), /OUTBOX_FULL/);
  const root = path.dirname(box.dir);
  for (let index = 1; index < 64; index++) new Outbox(root, { ...cfg, identity: `agent:${index}` });
  assert.throws(() => new Outbox(root, { ...cfg, identity: 'agent:overflow' }), /OUTBOX_FULL/);
});

test('inbox reads return leases for retry, never claim completed handoffs', async t => {
  const box = setup(t); await box.enqueue(start); const remote = server(); const acknowledgements = [];
  await box.flush(async (name, args) => {
    if (name === 'receive_inbox') return { messages: [{ messageId: 'handoff', leaseGeneration: 3 }] };
    if (name === 'acknowledge') { acknowledgements.push(args); return {}; }
    return remote.call(name, args);
  });
  assert.deepEqual(acknowledgements, [{ identity: cfg.identity, scope: cfg.scope, message_id: 'handoff', lease_generation: 3, success: false }]);
});
test('per-turn Stop reports idle/waiting, never finished; SessionEnd still finishes', async t => {
  const box = setup(t); const remote = server(); await box.enqueue(start);
  await box.enqueue({ kind: 'Stop', key: 'turn-1', summary: 'Claude Code turn stopped; task outcome not verified' });
  await box.flush(remote.call);
  assert.equal(remote.surface.content.status, 'idle'); assert.equal(remote.surface.content.nextAction, 'Waiting for the next prompt');
  const stop = JSON.parse([...remote.messages.values()][1].body);
  assert.equal(stop.type, 'progress'); assert.equal(stop.waiting, true);
  await box.enqueue({ kind: 'PostToolUse', key: 'next-turn', summary: 'Working again' }); await box.flush(remote.call);
  assert.equal(remote.surface.content.status, 'working');
  await box.enqueue({ kind: 'SessionEnd', key: 'end', summary: 'Ended' }); await box.flush(remote.call);
  assert.equal(remote.surface.content.status, 'stopped');
  assert.equal(JSON.parse([...remote.messages.values()][3].body).type, 'work_finished');
});
