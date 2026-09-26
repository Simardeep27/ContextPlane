import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mvp02Scenario } from '@context-plane/scenario';
import type { EvidenceRecord } from './evidence.ts';
import { buildTree, changesSince, countNodes, graphFromEvidence, hasChangedSinceVerified, isStaleRun,
  RECORDED_SURFACE_ID, SEED_STRUCTURE, staleRuns, visibleRows, type GraphInput, type GraphRun } from './graph.ts';

const run = (runId: string, nodeId: string, dependencyRevision: number | null, outcome: GraphRun['outcome'] = 'passed',
  startedAt = '2026-01-01T00:00:00.000Z'): GraphRun => ({ runId, nodeId, dependencyRevision, policyEpoch: 1, startedAt,
  finishedAt: startedAt, agent: 'agent_x', outcome, reasons: [], hash: null, source: 'sample' });

const input = (): GraphInput => ({
  services: [
    { serviceId: 'orders', label: 'Orders', owner: 'agent_a', source: 'sample' },
    { serviceId: 'billing', label: 'Billing', owner: 'agent_b', source: 'sample' },
    { serviceId: 'ledger', label: 'Ledger', owner: null, source: 'sample' },
  ],
  surfaces: [{ surfaceId: 'orders:get', serviceId: 'orders', label: 'GET /orders', detail: '', revision: 8, source: 'sample' }],
  dependencies: [
    { dependencyId: 'dep_orders_billing', surfaceId: 'orders:get', consumerServiceId: 'billing', verifiedRevision: 6, verifiedEpoch: null, source: 'sample' },
    { dependencyId: 'dep_orders_ledger', surfaceId: 'orders:get', consumerServiceId: 'ledger', verifiedRevision: 8, verifiedEpoch: null, source: 'sample' },
  ],
  runs: [run('r1', 'dep_orders_billing', 6), run('r2', 'dep_orders_billing', 8, 'passed', '2026-01-01T00:01:00.000Z'),
    run('r3', 'dep_orders_ledger', 8)],
  changes: [
    { changeId: 'c7', nodeId: 'orders:get', at: '2026-01-01T00:00:10.000Z', actor: 'agent_a', summary: 'r6→r7', fromRevision: 6, toRevision: 7, kind: 'publication', hash: null, source: 'sample' },
    { changeId: 'c8', nodeId: 'orders:get', at: '2026-01-01T00:00:20.000Z', actor: 'agent_a', summary: 'r7→r8', fromRevision: 7, toRevision: 8, kind: 'publication', hash: null, source: 'sample' },
  ],
});

test('buildTree nests service -> surface -> consumer and omits consumer-only roots', () => {
  const tree = buildTree(input());
  assert.deepEqual(tree.map(n => n.label), ['Orders']);
  const [surface] = tree[0]!.children;
  assert.equal(surface!.label, 'GET /orders');
  assert.deepEqual(surface!.children.map(c => [c.label, c.depth, c.verifiedRevision]), [['Billing', 2, 6], ['Ledger', 2, 8]]);
  assert.deepEqual(surface!.usedBy, [{ consumer: 'Billing', revision: 6 }, { consumer: 'Ledger', revision: 8 }]);
  assert.equal(countNodes(tree), 4);
  assert.equal(visibleRows(tree, new Set(['orders:get'])).length, 2);
  assert.equal(visibleRows(tree, new Set(['service:orders'])).length, 1);
});

test('stale runs are runs whose revision is below the current revision', () => {
  assert.equal(isStaleRun({ dependencyRevision: 7, hash: null }, 8), true);
  assert.equal(isStaleRun({ dependencyRevision: 8, hash: null }, 8), false);
  assert.equal(isStaleRun({ dependencyRevision: null, hash: null }, 8), false);
  const tree = buildTree(input());
  const billing = tree[0]!.children[0]!.children[0]!;
  assert.deepEqual(billing.staleRuns.map(r => r.runId), ['r1']);
  assert.deepEqual(tree[0]!.staleRuns.map(r => r.runId), ['r1']);
  assert.deepEqual(staleRuns([run('a', 'x', 1), run('b', 'x', 3)], 3).map(r => r.runId), ['a']);
});

test('a run that produced revision N is not stale against N; a non-publishing run at N-1 is', () => {
  const data = input();
  data.changes.push({ changeId: 'pub9', nodeId: 'orders:get', at: '2026-01-01T00:02:00.000Z', actor: 'agent_a',
    summary: 'r8→r9', fromRevision: 8, toRevision: 9, kind: 'publication', hash: 'sha256:aaa', source: 'sample' });
  data.surfaces[0]!.revision = 9;
  data.runs = [
    { ...run('publish-r9', 'dep_orders_ledger', 8, 'published'), hash: 'sha256:aaa' },
    { ...run('check-r9', 'dep_orders_ledger', 8, 'passed'), hash: 'sha256:aaa' },
    { ...run('proposal-other', 'dep_orders_ledger', 8, 'blocked'), hash: 'sha256:bbb' },
    run('no-hash', 'dep_orders_ledger', 8),
  ];
  assert.equal(isStaleRun({ dependencyRevision: 8, hash: 'sha256:aaa' }, 9, [{ hash: 'sha256:aaa', toRevision: 9 }]), false);
  assert.equal(isStaleRun({ dependencyRevision: 8, hash: 'sha256:bbb' }, 9, [{ hash: 'sha256:aaa', toRevision: 9 }]), true);
  const ledger = buildTree(data)[0]!.children[0]!.children[1]!;
  assert.deepEqual(ledger.staleRuns.map(r => r.runId).sort(), ['no-hash', 'proposal-other']);
});

test('change detection flags consumers behind the surface and lists the changes they missed', () => {
  assert.equal(hasChangedSinceVerified(8, 6), true);
  assert.equal(hasChangedSinceVerified(8, 8), false);
  assert.equal(hasChangedSinceVerified(8, null), true);
  const tree = buildTree(input());
  const [billing, ledger] = tree[0]!.children[0]!.children;
  assert.equal(billing!.changed, true); assert.equal(billing!.status, 'stale');
  assert.deepEqual(billing!.changes.map(c => c.changeId), ['c7', 'c8']);
  assert.equal(ledger!.changed, false); assert.equal(ledger!.status, 'current');
  assert.deepEqual(changesSince(tree[0]!.children[0]!.changes, 7).map(c => c.changeId), ['c8']);
  assert.equal(tree[0]!.status, 'stale');
});

test('a blocked latest run marks the consumer blocked and propagates up', () => {
  const data = input(); data.runs.push(run('r9', 'dep_orders_ledger', 8, 'blocked', '2026-01-01T00:05:00.000Z'));
  const tree = buildTree(data);
  assert.equal(tree[0]!.children[0]!.children[1]!.status, 'blocked');
  assert.equal(tree[0]!.status, 'blocked');
});

test('SEED_STRUCTURE mirrors the MVP-02 scenario seed', () => {
  const d = mvp02Scenario.dependency;
  assert.deepEqual([d.dependencyId, d.providerServiceId, d.consumerServiceId, d.contract],
    [SEED_STRUCTURE.dependencyId, SEED_STRUCTURE.providerServiceId, SEED_STRUCTURE.consumerServiceId, SEED_STRUCTURE.contract]);
  for (const dev of mvp02Scenario.developers) assert.equal(SEED_STRUCTURE.owners[dev.serviceId], dev.agentId);
});

test('recorded verification evidence yields rev 8 with the r7 runs flagged stale', () => {
  const recording = JSON.parse(readFileSync(new URL('../public/verification.json', import.meta.url), 'utf8')) as { records: EvidenceRecord[] };
  const tree = buildTree(graphFromEvidence(recording.records));
  const surface = tree[0]!.children.find(s => s.id === RECORDED_SURFACE_ID)!;
  assert.equal(surface.revision, 8);
  const billing = surface.children[0]!;
  assert.equal(billing.id, 'dependency_orders_billing');
  assert.equal(billing.verifiedRevision, 8); assert.equal(billing.changed, false);
  // Only the real stale proposal remains; the r7 chain that published r8 is exempt.
  assert.deepEqual(billing.staleRuns.map(r => [r.runId, r.outcome]), [['propose-stale', 'blocked']]);
  assert.ok(billing.runs.some(r => r.runId === 'publish-dev-b' && r.dependencyRevision === 7));
  const rule = tree.flatMap(t => t.children).find(s => s.label.startsWith('Coordination rule'))!;
  assert.deepEqual(rule.staleRuns, [], 'the rule proposal that produced epoch 2 is not stale against epoch 2');
  assert.ok(billing.runs.every(r => r.agent === null), 'agent is not in the recorded allowlist and must not be inferred');
  const publication = surface.changes.find(c => c.kind === 'publication' && c.toRevision === 8);
  assert.equal(publication?.fromRevision, 7);
  assert.ok(tree.flatMap(t => t.children).some(s => s.label.startsWith('Coordination rule') && s.revision === 2));
});
