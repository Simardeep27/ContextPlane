import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuration, observation } from './codex.mjs';
import { Outbox } from './outbox.mjs';
const env = { CP_SYNC_IDENTITY: 'shivraj:codex-test', CP_SYNC_PERSON: 'Shivraj', CP_SYNC_INSTANCE: '411b80e3-8680-4ee7-8f25-691a24e90219', CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/27' };
const input = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'test-tool', session_id: 'test-session' };
test('Codex normalizes failure without leaking raw output; opaque failure is not a success claim', () => {
  const failed = observation({ ...input, tool_response: { exit_code: 2, output: 'secret' }, tool_input: { command: 'secret' } });
  assert.equal(failed.kind, 'PostToolUseFailure'); assert.equal(JSON.stringify(failed).includes('secret'), false);
  const opaque = observation({ ...input, tool_response: 'command failed with secret' });
  assert.match(opaque.summary, /success or failure not verified/);
  assert.equal(observation({ ...input, tool_name: 'mcp__private' }), null);
  assert.equal(observation({ ...input, tool_name: 'apply_patch' }).kind, 'PostToolUse');
  assert.equal(configuration(env, input.session_id).client, 'codex-hooks');
});
test('Codex tool and turn keys deduplicate stable native IDs', () => {
  assert.equal(observation(input).key, observation(input).key);
  const stop = { ...input, hook_event_name: 'Stop', turn_id: 'turn-1' };
  assert.equal(observation(stop).key, observation(stop).key);
  assert.notEqual(observation(stop).key, observation({ ...stop, turn_id: 'turn-2' }).key);
  assert.throws(() => observation({ ...input, tool_use_id: '' }), /INVALID_TOOL_ID/);
});
test('SessionEnd captures durably without a token or network and exits before the native deadline', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hook-')); t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const hook = fileURLToPath(new URL('./codex-hook.mjs', import.meta.url));
  const started = Date.now();
  const result = spawnSync(process.execPath, [hook], { env: { PATH: process.env.PATH, ...env, CP_SYNC_CODEX: '1', CP_SYNC_REPO: repo }, input: JSON.stringify({ ...input, hook_event_name: 'SessionEnd', transcript_path: 'secret' }), encoding: 'utf8', timeout: 2500 });
  assert.equal(result.status, 0, result.stderr); assert.ok(Date.now() - started < 2500);
  const box = new Outbox(path.join(repo, '.artifacts/context-sync'), configuration(env, input.session_id));
  assert.equal(box.read().pending.length, 1); assert.equal(JSON.stringify(box.read()).includes('secret'), false);
  const lock = path.join(box.dir, 'state.lock'); fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  const failed = spawnSync(process.execPath, [hook], { env: { PATH: process.env.PATH, ...env, CP_SYNC_CODEX: '1', CP_SYNC_REPO: repo }, input: JSON.stringify({ ...input, hook_event_name: 'SessionEnd' }), encoding: 'utf8', timeout: 2500 });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /UNSYNCHRONIZED/); assert.equal(box.read().pending.length, 1);
});
test('Codex hook is inert outside an explicitly enrolled launcher', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./codex-hook.mjs', import.meta.url))], { env: { PATH: process.env.PATH }, input: 'not-json', encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout, '');
});
