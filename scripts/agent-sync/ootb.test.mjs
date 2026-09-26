import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { branchSlug, configuration, hookEnvironment, instanceFor } from './claude.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const git = values => args => values[args.join(' ')] ?? '';
const input = { hook_event_name: 'SessionStart', source: 'startup', session_id: 'session-abc' };

test('identity derives <person>:<branch-slug> from CP_SYNC_PERSON or git author', () => {
  const env = hookEnvironment({ CONTEXT_PLANE_API_TOKEN: 'x'.repeat(20), CP_SYNC_PERSON: 'Simar' }, input, '/repo',
    git({ 'rev-parse --abbrev-ref HEAD': 'feature/Auto_Sync' }));
  assert.equal(env.CP_SYNC_IDENTITY, 'simar:feature-auto-sync');
  assert.equal(env.CP_SYNC_INSTANCE, instanceFor('session-abc'));
  assert.match(env.CP_SYNC_INSTANCE, /^[0-9a-f-]{36}$/);
  assert.equal(env.CP_SYNC_REPO, '/repo');
  assert.ok(configuration(env, input.session_id));
  const mapped = hookEnvironment({ CONTEXT_PLANE_API_TOKEN: 'x'.repeat(20) }, input, '/repo',
    git({ 'config user.name': 'Tanish V', 'rev-parse --abbrev-ref HEAD': 'main' }));
  assert.equal(mapped.CP_SYNC_IDENTITY, 'tanish:main');
  assert.equal(hookEnvironment({ CONTEXT_PLANE_API_TOKEN: 'x'.repeat(20) }, input, '/repo', git({ 'config user.name': 'Someone Else' })), null);
  assert.throws(() => hookEnvironment({ CONTEXT_PLANE_API_TOKEN: 'x'.repeat(20), CP_SYNC_PERSON: 'Mallory' }, input, '/repo', git({})), /INVALID_PERSON/);
  assert.equal(branchSlug('HEAD'), 'detached');
});

test('recipient is the sender\'s own primary identity unless CP_SYNC_RECIPIENT is set', () => {
  const base = { CP_SYNC_IDENTITY: 'buddhsen:main', CP_SYNC_INSTANCE: instanceFor('s'),
    CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/27', CP_SYNC_PERSON: 'Buddhsen' };
  assert.equal(configuration(base, 's').recipient, 'buddhsen:primary');
  assert.equal(configuration({ ...base, CP_SYNC_RECIPIENT: 'simar:primary' }, 's').recipient, 'simar:primary');
  assert.throws(() => configuration({ ...base, CP_SYNC_RECIPIENT: 'Bad Recipient' }, 's'), /INVALID_RECIPIENT/);
});

test('project hook without a token exits 0 silently and writes nothing', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sync-ootb-'));
  try {
    const result = spawnSync(process.execPath, [cli, 'hook', '--project'], { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: repo,
      CP_SYNC_PERSON: 'Shivraj' }, input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(fs.existsSync(path.join(repo, '.artifacts')), false);
    const bad = spawnSync(process.execPath, [cli, 'hook', '--project'], { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: repo },
      input: 'not-json', encoding: 'utf8', timeout: 5000 });
    assert.equal(bad.status, 0); assert.equal(bad.stderr.trim().split('\n').length, 1);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('identity prefix must name the person running the agent', async () => {
  const { identityMatchesPerson, configuration } = await import('./claude.mjs');
  assert.equal(identityMatchesPerson('simar:primary', 'Simar'), true);
  assert.equal(identityMatchesPerson('buddh:primary', 'Buddhsen'), true);
  assert.equal(identityMatchesPerson('shivraj:mvp-07', 'Simar'), false);
  const env = { CP_SYNC_IDENTITY: 'shivraj:mvp-07', CP_SYNC_PERSON: 'Simar', CP_SYNC_INSTANCE: '12345678-1234-1234-1234-123456789012',
    CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/17' };
  assert.throws(() => configuration(env, 'session-1'), /IDENTITY_PERSON_MISMATCH/);
  assert.equal(configuration({ ...env, CP_SYNC_IDENTITY: 'simar:mvp-07' }, 'session-1').person, 'Simar');
});
