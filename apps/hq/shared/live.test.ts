import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentView, ChipStatus } from './harness.ts';
import { answerLive, companyInsights, companyStatus, initialPanelState, INSIGHT_PERIOD_MS, insightIndex, layoutTeam, legendState, liveHeader, newReports, padCenters, padRadius, padSummary, ringOffsets, ROBOT_SPACING, sceneShift } from './live.ts';

const view = (identity: string, person: string, status: ChipStatus = 'working', updatedAt: string | null = '2026-09-26T20:00:00.000Z', summary: string | null = null): AgentView =>
  ({ identity, suffix: identity.split(':')[1] ?? identity, person, status, task: null, summary, files: [], updatedAt, lastEventType: null, idleMinutes: 0 });
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[a.length - 1]! - b[b.length - 1]!);

test('status maps onto the existing legend colors', () => {
  assert.equal(legendState('working'), 'coding');
  assert.equal(legendState('blocked'), 'blocked');
  assert.equal(legendState('finished'), 'complete');
  assert.equal(legendState('idle'), 'idle');
});

test('ring layout handles 1 to 12 agents without overlap', () => {
  assert.deepEqual(ringOffsets(0), []);
  assert.deepEqual(ringOffsets(1), [[0, 0]]);
  for (let n = 2; n <= 12; n++) {
    const ring = ringOffsets(n);
    assert.equal(ring.length, n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(dist(ring[i]!, ring[j]!) >= ROBOT_SPACING * 0.6, `n=${n} robots ${i},${j} overlap`);
    for (const p of ring) assert.ok(Math.hypot(p[0], p[1]) < padRadius(n), `n=${n} robot off its pad`);
  }
});

test('pads for four people and an Other pad never overlap, even at 12 agents each', () => {
  for (const count of [4, 5]) {
    const centers = padCenters(count);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) assert.ok(dist(centers[i]!, centers[j]!) > padRadius(12) * 2, `pads ${i},${j}`);
    for (const c of centers) assert.ok(Math.hypot(c[0], c[2]) - padRadius(12) > 1, 'pad clears the central brain');
  }
});

test('layoutTeam groups agents per person, keeps empty pads, and adds Other only when needed', () => {
  const shivraj = Array.from({ length: 11 }, (_, i) => view(`shivraj:a${String(i).padStart(2, '0')}`, 'Shivraj'));
  const pads = layoutTeam([...shivraj, view('buddhsen:x', 'Buddh'), view('codex:y', 'Other')]);
  assert.deepEqual(pads.map(p => p.label), ['Shivraj', 'Simar', 'Buddhsen', 'Tanish', 'Other']);
  assert.equal(pads[0]!.agents.length, 11);
  assert.equal(pads[1]!.agents.length, 0);
  assert.equal(pads[4]!.agents[0]!.view.identity, 'codex:y');
  assert.deepEqual(pads[2]!.agents[0]!.position, pads[2]!.center);
  assert.equal(layoutTeam([view('shivraj:a', 'Shivraj')]).length, 4);
});

test('header, new-report detection and deterministic answers', () => {
  assert.equal(liveHeader(11, new Date(2026, 8, 26, 9, 5, 7)), 'Live · 11 agents · last fetched 09:05:07');
  assert.equal(liveHeader(1, null), 'Live · 1 agent · last fetched never');
  const before = [view('a:1', 'Shivraj'), view('a:2', 'Simar')];
  const after = [view('a:1', 'Shivraj', 'working', '2026-09-26T20:01:00.000Z'), view('a:2', 'Simar'), view('a:3', 'Tanish')];
  assert.deepEqual(newReports(null, after), []);
  assert.deepEqual(newReports(before, after), ['a:1', 'a:3']);
  const team = [view('s:ui', 'Shivraj', 'working', null, 'Building HQ'), view('t:api', 'Tanish', 'blocked', null, 'Needs token'), view('b:x', 'Buddh', 'finished', null, 'Shipped MCP')];
  const everyone = answerLive('What is everyone working on?', team);
  assert.equal(everyone.lines.length, 3);
  assert.equal(everyone.lines[0]!.status, 'blocked');
  assert.deepEqual(answerLive('Who is blocked?', team).lines.map(l => l.text), ['Tanish · api (blocked): Needs token']);
  assert.deepEqual(answerLive('What has finished?', team).lines.map(l => l.identity), ['b:x']);
  assert.deepEqual(answerLive('Who is idle?', team).lines, []);
  assert.equal(answerLive('Who is blocked?', []).empty, 'Nobody is blocked right now.');
});

const report = (over: Partial<Parameters<typeof companyInsights>[0] & object> = {}) => ({
  suggestion: 'shivraj:deploy has been quiet 44m — check in or send work_finished', collisions: [], idleAgents: [],
  active: 2, blocked: 0, finished: 3, eventsLastHour: 7, ...over });

test('company insights list the suggestion, collisions, blocked, idle and finished counts', () => {
  assert.deepEqual(companyInsights(null, []), ['Waiting for the first team report']);
  const idle = { ...view('shivraj:deploy', 'Shivraj', 'idle'), idleMinutes: 44 };
  const blocked = view('simar:api', 'Simar', 'blocked', undefined, 'waiting on keys');
  const lines = companyInsights(report({ collisions: [{ a: 'a:x', b: 'b:y', reason: 'files', subject: 'src/app.ts' }], idleAgents: [idle], blocked: 1 }), [blocked, idle]);
  assert.deepEqual(lines, [
    'shivraj:deploy has been quiet 44m — check in or send work_finished',
    'a:x and b:y both touch src/app.ts',
    'simar:api is blocked: waiting on keys',
    'shivraj:deploy has been quiet 44m',
    '3 finished · 2 active · 7 events in the last hour',
  ]);
  const dup = companyInsights(report({ suggestion: 'shivraj:deploy has been quiet 44m', idleAgents: [idle] }), [idle]);
  assert.equal(dup.filter(l => l === 'shivraj:deploy has been quiet 44m').length, 1);
});

test('insight rotation cycles every period and tolerates empty lists', () => {
  assert.equal(insightIndex(0, 99_999), 0);
  assert.equal(insightIndex(3, 0), 0);
  assert.equal(insightIndex(3, INSIGHT_PERIOD_MS - 1), 0);
  assert.equal(insightIndex(3, INSIGHT_PERIOD_MS), 1);
  assert.equal(insightIndex(3, INSIGHT_PERIOD_MS * 3), 0);
  assert.equal(insightIndex(3, -500), 0);
  assert.equal(insightIndex(3, NaN), 0);
});

test('company status chip prioritises collisions, then blocked, then activity', () => {
  assert.equal(companyStatus(null).tone, 'waiting');
  assert.equal(companyStatus(report({ collisions: [{ a: 'a', b: 'b', reason: 'task', subject: 't' }] })).label, '1 collision');
  assert.deepEqual(companyStatus(report({ blocked: 2 })), { label: '2 blocked', tone: 'attention' });
  assert.deepEqual(companyStatus(report()), { label: 'Optimizing · 2 active', tone: 'ok' });
  assert.deepEqual(companyStatus(report({ active: 0 })), { label: 'Team quiet', tone: 'quiet' });
});

test('pad summary names agents with working and blocked counts', () => {
  assert.equal(padSummary([]), 'no agents reporting');
  assert.equal(padSummary([view('a:1', 'A')]), '1 agent · 1 working');
  assert.equal(padSummary([view('a:1', 'A'), view('a:2', 'A', 'blocked'), view('a:3', 'A', 'idle')]), '3 agents · 1 working · 1 blocked');
  assert.equal(padSummary([view('a:1', 'A', 'finished')]), '1 agent · none active');
});

test('panel defaults to collapsed below 1360px unless a valid choice is stored', () => {
  assert.equal(initialPanelState(null, 1280), 'collapsed');
  assert.equal(initialPanelState(null, 1440), 'open');
  assert.equal(initialPanelState('max', 1280), 'max');
  assert.equal(initialPanelState('bogus', 1440), 'open');
});

test('scene shifts right only while the left panel is open on wide screens', () => {
  assert.equal(sceneShift(1440, 'collapsed'), 0);
  assert.equal(sceneShift(800, 'open'), 0);
  const open = sceneShift(1440, 'open');
  assert.ok(open > 2 && open < 4.5, `shift ${open}`);
  assert.ok(sceneShift(1280, 'open') > open, 'narrower screens need a larger world shift');
  assert.ok(sceneShift(1000, 'max', 2000) <= 4.5);
});
