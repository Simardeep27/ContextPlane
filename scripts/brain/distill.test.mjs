import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBrainRepository } from '../../packages/mcp/dist/brain.js';
import { applyDistillation, distill } from './distill.mjs';

const scope = 'project:context-plane';
const report = (messageId, actor, instanceId, type, occurredAt, extra = {}) => ({
  messageId, senderIdentity: actor, createdAt: occurredAt,
  body: JSON.stringify({ eventId: messageId, type, actor, instanceId, task: 'https://github.com/Simardeep27/ContextPlane/issues/40',
    summary: `${type} by ${actor}`, files: [], occurredAt, evidenceKind: 'self_report', ...extra }),
});
const fixtures = [
  report('simar:1', 'simar:primary', 'inst-a', 'work_started', '2026-09-26T10:00:00Z', { files: ['packages/mcp/src/domain.ts'] }),
  report('buddh:1', 'buddh:primary', 'inst-b', 'work_started', '2026-09-26T10:20:00Z', { files: ['packages/mcp/src/domain.ts', 'README.md'] }),
  report('simar:2', 'simar:primary', 'inst-a', 'progress', '2026-09-26T10:40:00Z'),
  report('simar:3', 'simar:primary', 'inst-a', 'work_finished', '2026-09-26T11:00:00Z'),
  report('buddh:2', 'buddh:primary', 'inst-b', 'work_finished', '2026-09-26T12:00:00Z'),
  report('tanish:1', 'tanish:primary', 'inst-c', 'work_started', '2026-09-26T15:00:00Z', { files: ['README.md'] }),
  { messageId: 'free-text', senderIdentity: 'shivraj:primary', createdAt: '2026-09-26T16:00:00Z', body: 'Plain note, not JSON.' },
];

test('distill derives one episode per agent session, collisions within 30 minutes, and a finished count', () => {
  const derived = distill(fixtures);
  const episodes = derived.filter(item => item.kind === 'episode');
  assert.equal(episodes.length, 4);
  const simar = episodes.find(item => item.key === 'episode:simar%3Aprimary:inst-a');
  assert.deepEqual(simar.sourceIds, ['simar:1', 'simar:2', 'simar:3']);
  assert.match(simar.title, /finished/);
  assert.match(simar.body, /work_started[\s\S]*progress[\s\S]*work_finished/);
  assert.ok(Buffer.byteLength(simar.body) <= 4096);
  const collisions = derived.filter(item => item.key.startsWith('insight:collision:'));
  assert.equal(collisions.length, 1, 'tanish reported README.md hours later, outside the window');
  assert.deepEqual(collisions[0].sourceIds, ['buddh:1', 'simar:1']);
  assert.match(collisions[0].body, /packages\/mcp\/src\/domain\.ts/);
  const finished = derived.find(item => item.key === 'insight:finished:2026-09-26');
  assert.equal(finished.title, '2 agents finished tasks on 2026-09-26');
  assert.deepEqual(distill([...fixtures].reverse()), derived, 'input order does not matter');
});

test('applyDistillation is idempotent and supersedes when a session grows', async () => {
  const brain = new MemoryBrainRepository();
  const first = await applyDistillation(brain, scope, 'steward:context', distill(fixtures));
  assert.deepEqual(first, { created: 6, unchanged: 0, superseding: 0 });
  assert.deepEqual(await applyDistillation(brain, scope, 'steward:context', distill(fixtures)),
    { created: 0, unchanged: 6, superseding: 0 });
  const grown = [...fixtures, report('tanish:2', 'tanish:primary', 'inst-c', 'work_finished', '2026-09-26T17:00:00Z')];
  assert.deepEqual(await applyDistillation(brain, scope, 'steward:context', distill(grown)),
    { created: 2, unchanged: 4, superseding: 2 });
  const active = await brain.recall(scope, { kinds: ['episode', 'insight'], limit: 50 });
  assert.equal(active.length, 6, 'superseded entries leave the active set');
  assert.equal(brain.entries.size, 8, 'nothing is overwritten');
  assert.ok(active.some(entry => entry.title === '3 agents finished tasks on 2026-09-26'));
  assert.ok(active.every(entry => entry.author === 'steward:context'));
});
