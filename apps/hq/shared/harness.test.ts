import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentViews, collisions, groupByPerson, optimize, suffixOf } from './harness.ts';
import { projectTeam, type TeamEvent } from './team.ts';
const now = new Date('2026-09-26T20:00:00Z');
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
const surface = (ownerIdentity: string, content: Record<string, unknown>) => ({ ownerIdentity, content, revision: 1, surfaceName: 'work-status', kind: 'team-context', coordinationScope: 'project:context-plane', updatedAt: now.toISOString() });
const message = (actor: string, type: string, minAgo: number, extra: Record<string, unknown> = {}) => ({ identity: actor, body: JSON.stringify({ type, actor, summary: `${type} by ${actor}`, files: [], occurredAt: at(minAgo), secret: 'raw-body-secret', ...extra }) });
const fixture = () => projectTeam({ context: {
  surfaces: [
    surface('shivraj:primary', { status: 'working', task: 'Coordinate', updatedAt: at(2) }),
    surface('shivraj:ui', { status: 'working', task: 'HQ team view', files: ['apps/hq/src/team/main.tsx'], updatedAt: at(3) }),
    surface('shivraj:sync:hook-3e07', { status: 'stopped', updatedAt: at(30) }),
    surface('simar:primary', { status: 'working', updatedAt: at(40) }),
    surface('tanish:primary', { status: 'blocked', blockedOn: ['Needs token'], updatedAt: at(50) }),
    surface('codex:nyny', { status: 'working', updatedAt: at(1) }),
  ],
  messages: [
    message('simar:primary', 'progress', 1, { files: ['apps/hq/src/team/team.css'] }),
    message('shivraj:primary', 'work_finished', 1, { summary: 'Shipped the coordinator pass' }),
    message('buddhsen:primary', 'work_started', 5, { task: 'Fix #41 flake' }),
    message('buddhsen:primary', 'progress', 4, { task: 'Fix #41 flake' }),
    message('codex:nyny', 'progress', 0, { task: 'Investigate issues/41' }),
    { identity: 'x', body: 'not json' }, { identity: 'x', body: JSON.stringify({ type: 'unknown', actor: 'x', occurredAt: at(1) }) },
  ],
} }, now);

test('projection keeps only allowlisted event fields and drops malformed events', () => {
  const snap = fixture();
  assert.equal(snap.events.length, 5);
  assert.ok(!JSON.stringify(snap).includes('raw-body-secret'));
  assert.deepEqual(Object.keys(snap.events[0]!).sort(), ['actor', 'files', 'occurredAt', 'summary', 'task', 'type']);
  assert.deepEqual(projectTeam({ context: { surfaces: [] } }, now).events, []);
});

test('groups several agents per person by identity prefix, with buddhsen and other buckets', () => {
  const groups = groupByPerson(agentViews(fixture(), now.getTime()));
  const by = Object.fromEntries(groups.map(g => [g.person, g.agents.map(a => a.suffix)]));
  assert.deepEqual(by.Shivraj, ['primary', 'sync:hook-3e07', 'ui']);
  assert.deepEqual(by.Buddh, ['primary']);
  assert.deepEqual(by.Other, ['nyny']);
  assert.deepEqual(groups.map(g => g.person), ['Shivraj', 'Simar', 'Buddh', 'Tanish', 'Other']);
  assert.equal(suffixOf('solo'), 'solo');
});

test('status chips: newest signal wins; finished, blocked, idle and working', () => {
  const views = Object.fromEntries(agentViews(fixture(), now.getTime()).map(v => [v.identity, v]));
  assert.equal(views['shivraj:primary']?.status, 'finished');
  assert.equal(views['shivraj:primary']?.summary, 'Shipped the coordinator pass');
  assert.equal(views['shivraj:sync:hook-3e07']?.status, 'finished');
  assert.equal(views['simar:primary']?.status, 'working'); // surface is stale but ledger progress is recent
  assert.equal(views['tanish:primary']?.status, 'blocked');
  assert.equal(views['shivraj:ui']?.status, 'working');
  const idle = agentViews(projectTeam({ context: { surfaces: [surface('simar:ui', { status: 'working', updatedAt: at(16) }), surface('simar:x', { status: 'working' })] } }, now), now.getTime());
  assert.deepEqual(idle.map(v => v.status), ['idle', 'idle']);
  const handoff = agentViews({ agents: [], events: [{ type: 'handoff', actor: 'simar:primary', task: null, summary: 'to tanish', files: [], occurredAt: at(1) }] }, now.getTime());
  assert.equal(handoff[0]?.status, 'finished');
});

test('collisions: overlapping files or directories, shared issue, same task; finished agents never collide', () => {
  const found = collisions(agentViews(fixture(), now.getTime()));
  assert.deepEqual(found.map(c => [c.a, c.b, c.subject]), [
    ['buddhsen:primary', 'codex:nyny', 'issue #41'],
    ['shivraj:ui', 'simar:primary', 'apps/hq/src/team'],
  ]);
  const ev = (actor: string, files: string[], task: string | null = null): TeamEvent => ({ type: 'progress', actor, task, summary: null, files, occurredAt: at(1) });
  const exact = collisions(agentViews({ agents: [], events: [ev('a:1', ['README.md']), ev('b:1', ['README.md']), ev('c:1', ['docs/x.md'], 'Same Task'), ev('d:1', ['docs/y.md'], 'same  task'), { ...ev('e:1', ['README.md']), type: 'work_finished' }] }, now.getTime()));
  assert.deepEqual(exact.map(c => [c.a, c.b, c.reason, c.subject]), [['a:1', 'b:1', 'files', 'README.md'], ['c:1', 'd:1', 'task', 'Same Task']]);
});

test('optimizer counts events and agents and produces a rule-based suggestion', () => {
  const report = optimize(fixture(), now.getTime());
  assert.equal(report.eventSource, 'ledger');
  assert.equal(report.totalEvents, 5); assert.equal(report.eventsLastHour, 5);
  assert.deepEqual([report.active, report.blocked, report.finished, report.idle], [5, 1, 2, 0]);
  assert.equal(report.suggestion, 'buddhsen:primary and codex:nyny both touch issue #41 — coordinate');
  const quiet = optimize(projectTeam({ context: { surfaces: [surface('simar:ui', { status: 'working', updatedAt: at(42) })] } }, now), now.getTime());
  assert.equal(quiet.eventSource, 'surfaces');
  assert.equal(quiet.suggestion, 'simar:ui has been quiet 42m — check in or send work_finished');
  assert.equal(optimize({ agents: [], events: [] }, now.getTime()).suggestion, 'No active agents — pick up the next task');
});

test('per-turn Stop is idle/waiting, never finished; work_finished and SessionEnd still finish', () => {
  const stopSurface = { status: 'idle', currentTask: 'Claude Code turn stopped; task outcome not verified', updatedAt: at(1) };
  const views = Object.fromEntries(agentViews(projectTeam({ context: {
    surfaces: [surface('simar:hook-a', stopSurface), surface('tanish:legacy', { status: 'stopped', currentTask: 'Codex turn stopped; task outcome not verified', updatedAt: at(1) }),
      surface('buddhsen:end', { status: 'stopped', currentTask: 'Claude Code session ended; task outcome not verified', updatedAt: at(1) })],
    messages: [
      message('simar:hook-a', 'progress', 1, { summary: 'Claude Code turn stopped; task outcome not verified', waiting: true }),
      message('shivraj:legacy', 'work_finished', 1, { summary: 'Claude Code turn stopped; task outcome not verified' }),
      message('shivraj:done', 'work_finished', 1, { summary: 'Merged PR #39' }),
      message('buddhsen:end', 'work_finished', 1, { summary: 'Claude Code session ended; task outcome not verified' }),
    ] } }, now), now.getTime()).map(v => [v.identity, v.status]));
  assert.deepEqual(views, { 'buddhsen:end': 'finished', 'shivraj:done': 'finished', 'shivraj:legacy': 'idle', 'simar:hook-a': 'idle', 'tanish:legacy': 'idle' });
  const snap = projectTeam({ context: { surfaces: [], messages: [message('a:1', 'progress', 1, { waiting: true })] } }, now);
  assert.equal(snap.events[0]?.waiting, true);
});

test('sample org fixture: 6 people, 2-4 agents each, collisions, finished, blocked and waiting', async () => {
  const { sampleSnapshot, sampleOrder, samplePersonOf } = await import('./sample.ts');
  const t = now.getTime(); const snap = sampleSnapshot(t);
  const groups = groupByPerson(agentViews(snap, t, samplePersonOf), sampleOrder);
  assert.equal(groups.length, 6); assert.ok(groups.every(g => g.agents.length >= 2 && g.agents.length <= 4));
  const report = optimize(snap, t, samplePersonOf);
  assert.ok(report.collisions.length >= 2); assert.equal(report.finished, 2); assert.equal(report.blocked, 1); assert.equal(report.idle, 1);
});
