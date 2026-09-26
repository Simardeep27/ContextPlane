/**
 * Dependency graph model for the HQ graph view.
 *
 * Nodes are functionalities: a provider service, a versioned surface it exposes,
 * and each consumer that relies on that surface. Every record carries its source so
 * the UI can say whether it came from recorded run evidence, the scenario seed or a
 * SAMPLE fixture. Nothing here is live unless a caller supplies live records.
 */
import type { EvidenceRecord } from './evidence.ts';

export type GraphSource = 'recorded' | 'seed' | 'sample' | 'live';
export type NodeStatus = 'current' | 'stale' | 'blocked';
export type NodeKind = 'service' | 'surface' | 'consumer';
export type RunOutcome = 'passed' | 'failed' | 'published' | 'blocked' | 'allowed' | 'recorded';

export interface ServiceRecord { serviceId: string; label: string; owner: string | null; source: GraphSource }
export interface SurfaceRecord {
  surfaceId: string; serviceId: string; label: string; detail: string; revision: number; source: GraphSource;
}
/** One consumer's reliance on a surface. `verifiedRevision` is the last revision the consumer confirmed. */
export interface DependencyRecord {
  dependencyId: string; surfaceId: string; consumerServiceId: string; verifiedRevision: number | null;
  verifiedEpoch: number | null; source: GraphSource;
}
export interface GraphRun {
  runId: string; nodeId: string; dependencyRevision: number | null; policyEpoch: number | null;
  startedAt: string; finishedAt: string; agent: string | null; outcome: RunOutcome; reasons: string[];
  hash: string | null; source: GraphSource;
}
export interface GraphChange {
  changeId: string; nodeId: string; at: string; actor: string | null; summary: string;
  fromRevision: number | null; toRevision: number | null; kind: 'publication' | 'proposal' | 'policy';
  hash: string | null; source: GraphSource;
}
export interface GraphInput {
  services: ServiceRecord[]; surfaces: SurfaceRecord[]; dependencies: DependencyRecord[];
  runs: GraphRun[]; changes: GraphChange[];
}
export interface TreeNode {
  id: string; kind: NodeKind; label: string; detail: string; source: GraphSource; depth: number;
  revision: number | null; currentRevision: number | null; verifiedRevision: number | null;
  changed: boolean; status: NodeStatus; usedBy: { consumer: string; revision: number | null }[];
  runs: GraphRun[]; staleRuns: GraphRun[]; changes: GraphChange[]; children: TreeNode[];
}

const rank: Record<NodeStatus, number> = { current: 0, stale: 1, blocked: 2 };
export const worst = (statuses: NodeStatus[]): NodeStatus =>
  statuses.reduce<NodeStatus>((a, b) => (rank[b] > rank[a] ? b : a), 'current');

/**
 * A run is stale when it checked or proposed against a revision older than the node's current
 * revision AND did not itself produce the revision that superseded it. A run "produced" a newer
 * revision when a publication (or rule activation) carries the run's candidate hash and moves
 * past the run's revision, so the whole propose/stage/check/apply chain of a publication is exempt.
 */
export function isStaleRun(run: Pick<GraphRun, 'dependencyRevision' | 'hash'>, currentRevision: number | null,
  publications: readonly Pick<GraphChange, 'hash' | 'toRevision'>[] = []): boolean {
  if (run.dependencyRevision === null || currentRevision === null || run.dependencyRevision >= currentRevision) return false;
  const produced = run.hash !== null && publications.some(p =>
    p.hash === run.hash && p.toRevision !== null && p.toRevision > run.dependencyRevision!);
  return !produced;
}
/** Revision-moving changes that can exempt the runs that produced them. */
export const supersedingChanges = (changes: readonly GraphChange[]) =>
  changes.filter(c => c.hash !== null && c.toRevision !== null);
export const staleRuns = (runs: readonly GraphRun[], currentRevision: number | null,
  publications: readonly Pick<GraphChange, 'hash' | 'toRevision'>[] = []) =>
  runs.filter(run => isStaleRun(run, currentRevision, publications));

/** Changed since the consumer last verified: the surface moved past the consumer's verified revision. */
export function hasChangedSinceVerified(currentRevision: number | null, verifiedRevision: number | null): boolean {
  if (currentRevision === null) return false;
  return verifiedRevision === null || verifiedRevision < currentRevision;
}
export const changesSince = (changes: readonly GraphChange[], verifiedRevision: number | null) =>
  changes.filter(c => c.toRevision !== null && (verifiedRevision === null || c.toRevision > verifiedRevision));

const byTime = <T extends { at?: string; startedAt?: string }>(a: T, b: T) =>
  (a.at ?? a.startedAt ?? '').localeCompare(b.at ?? b.startedAt ?? '');

/** Service -> surface -> consumer tree. Parents aggregate descendants' runs, changes and status. */
export function buildTree(input: GraphInput): TreeNode[] {
  const serviceLabel = new Map(input.services.map(s => [s.serviceId, s.label]));
  const runsFor = (id: string) => input.runs.filter(r => r.nodeId === id).sort(byTime);
  const changesFor = (id: string) => input.changes.filter(c => c.nodeId === id).sort(byTime);
  // Services that expose no surface appear only as consumers, not as empty roots.
  const roots = input.services.filter(s => input.surfaces.some(x => x.serviceId === s.serviceId));
  return roots.map(service => {
    const surfaces = input.surfaces.filter(s => s.serviceId === service.serviceId).map(surface => {
      const deps = input.dependencies.filter(d => d.surfaceId === surface.surfaceId);
      const surfaceChanges = changesFor(surface.surfaceId);
      const consumers = deps.map<TreeNode>(dep => {
        const runs = runsFor(dep.dependencyId);
        const stale = staleRuns(runs, surface.revision, supersedingChanges(surfaceChanges));
        const changed = hasChangedSinceVerified(surface.revision, dep.verifiedRevision);
        const last = runs.at(-1);
        const status: NodeStatus = last?.outcome === 'blocked' ? 'blocked' : changed ? 'stale' : 'current';
        return {
          id: dep.dependencyId, kind: 'consumer', depth: 2, source: dep.source,
          label: serviceLabel.get(dep.consumerServiceId) ?? dep.consumerServiceId,
          detail: `${dep.dependencyId}${dep.verifiedEpoch !== null ? ` · rule epoch ${dep.verifiedEpoch}` : ''}`,
          revision: dep.verifiedRevision, currentRevision: surface.revision, verifiedRevision: dep.verifiedRevision,
          changed, status, usedBy: [], runs, staleRuns: stale,
          changes: [...changesFor(dep.dependencyId), ...changesSince(surfaceChanges, dep.verifiedRevision)].sort(byTime),
          children: [],
        };
      });
      const runs = [...runsFor(surface.surfaceId), ...consumers.flatMap(c => c.runs)].sort(byTime);
      return {
        id: surface.surfaceId, kind: 'surface', depth: 1, source: surface.source, label: surface.label,
        detail: surface.detail, revision: surface.revision, currentRevision: surface.revision, verifiedRevision: null,
        changed: consumers.some(c => c.changed), status: worst(consumers.map(c => c.status)),
        usedBy: deps.map(d => ({ consumer: serviceLabel.get(d.consumerServiceId) ?? d.consumerServiceId, revision: d.verifiedRevision })),
        runs, staleRuns: staleRuns(runs, surface.revision, supersedingChanges(surfaceChanges)), changes: surfaceChanges, children: consumers,
      } satisfies TreeNode;
    });
    const all = (key: 'runs' | 'staleRuns' | 'changes') => surfaces.flatMap(s => s[key] as never[]);
    return {
      id: `service:${service.serviceId}`, kind: 'service', depth: 0, source: service.source, label: service.label,
      detail: service.owner ? `owner ${service.owner}` : 'owner not recorded', revision: null, currentRevision: null,
      verifiedRevision: null, changed: surfaces.some(s => s.changed), status: worst(surfaces.map(s => s.status)),
      usedBy: [], runs: (all('runs') as GraphRun[]).sort(byTime), staleRuns: all('staleRuns') as GraphRun[],
      changes: (all('changes') as GraphChange[]).sort(byTime), children: surfaces,
    } satisfies TreeNode;
  });
}

/** Depth-first rows honoring collapsed ids. */
export function visibleRows(tree: readonly TreeNode[], collapsed: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => { out.push(n); if (!collapsed.has(n.id)) n.children.forEach(walk); };
  tree.forEach(walk);
  return out;
}
export const countNodes = (tree: readonly TreeNode[]): number =>
  tree.reduce((n, t) => n + 1 + countNodes(t.children), 0);

// ---------------------------------------------------------------------------
// Recorded evidence adapter (apps/hq/public/verification.json)
// ---------------------------------------------------------------------------

/** Structure mirrored from packages/scenario mvp02Scenario (asserted equal in graph.test.ts). */
export const SEED_STRUCTURE = {
  dependencyId: 'dependency_orders_billing', providerServiceId: 'orders', consumerServiceId: 'billing',
  contract: 'monetary-unit', owners: { orders: 'agent_dev_a_orders', billing: 'agent_dev_b_billing' },
} as const;
export const RECORDED_SURFACE_ID = 'surface:orders:monetary-unit';
export const RECORDED_RULE_ID = 'surface:orders:coordination-rule';
export const RECORDED_RULE_DEP = 'rule_orders_agent_context';

const outcomeOf = (r: EvidenceRecord): RunOutcome =>
  r.allowed === false ? 'blocked' : r.publishedHash ? 'published' : r.passed === true ? 'passed'
    : r.passed === false ? 'failed' : r.allowed === true ? 'allowed' : 'recorded';

/**
 * Turns the recorded evidence allowlist into graph input. The recorded records do not
 * carry the acting agent, so `agent` stays null rather than being inferred.
 */
export function graphFromEvidence(records: readonly EvidenceRecord[]): GraphInput {
  const finished = records.filter(r => r.phase === 'finished');
  const observed = records.map(r => r.observedDependencyRevision).filter((n): n is number => n !== null);
  const currentRevision = observed.length ? Math.max(...observed) : 0;
  const epochs = records.map(r => r.policyEpoch).filter((n): n is number => n !== null);
  const currentEpoch = epochs.length ? Math.max(...epochs) : 1;

  const ops = new Map<string, EvidenceRecord[]>();
  for (const r of records) if (r.operationKey) ops.set(r.operationKey, [...(ops.get(r.operationKey) ?? []), r]);
  const runs: GraphRun[] = [];
  for (const [key, group] of ops) {
    const end = group.at(-1)!; const start = group[0]!;
    const base = { runId: key, startedAt: start.at, finishedAt: end.at, agent: null, reasons: end.reasons,
      hash: end.candidateHash, source: 'recorded' as const };
    if (end.policy) {
      runs.push({ ...base, nodeId: RECORDED_RULE_DEP, dependencyRevision: end.policy.epoch, policyEpoch: end.policy.epoch,
        outcome: outcomeOf(end), hash: end.policy.hash || null });
    } else if (end.dependencyRevision !== null) {
      runs.push({ ...base, nodeId: SEED_STRUCTURE.dependencyId, dependencyRevision: end.dependencyRevision,
        policyEpoch: end.policyEpoch, outcome: outcomeOf(end) });
    }
  }

  const changes: GraphChange[] = [];
  for (const r of finished) {
    if (r.action === 'apply_change' && r.publishedHash) {
      const to = r.observedDependencyRevision; const from = r.dependencyRevision;
      changes.push({ changeId: r.eventId, nodeId: RECORDED_SURFACE_ID, at: r.at, actor: null, kind: 'publication',
        summary: to !== null && from !== null && to > from ? `Published ${r.operationKey}; dependency r${from} → r${to}`
          : `Published ${r.operationKey} at r${from ?? '?'}`,
        fromRevision: from, toRevision: to !== null && from !== null && to > from ? to : null, hash: r.publishedHash, source: 'recorded' });
    } else if (r.action === 'propose_change' && r.allowed === false) {
      changes.push({ changeId: r.eventId, nodeId: SEED_STRUCTURE.dependencyId, at: r.at, actor: null, kind: 'proposal',
        summary: `Refused ${r.operationKey}: ${r.reasons.join(', ') || 'no reason recorded'}`,
        fromRevision: r.dependencyRevision, toRevision: null, hash: r.candidateHash, source: 'recorded' });
    } else if (r.action === 'policy_activated' && r.policy) {
      const to = r.policy.epoch;
      changes.push({ changeId: r.eventId, nodeId: RECORDED_RULE_ID, at: r.at, actor: null, kind: 'policy',
        summary: `Activated rule ${r.policy.hash.slice(7, 15) || '?'} for ${r.policy.target || 'target not recorded'}`,
        fromRevision: to !== null ? to - 1 : null, toRevision: to, hash: r.policy.hash || null, source: 'recorded' });
    }
  }

  const acks = finished.filter(r => r.action === 'acknowledge_change');
  const lastAck = acks.at(-1);
  const ruleRuns = runs.filter(r => r.nodeId === RECORDED_RULE_DEP);
  // The ledger only records rule epochs on policy records; the activated epoch is the current one.
  const ruleEpoch = Math.max(currentEpoch, ...ruleRuns.map(r => r.policyEpoch ?? 0));
  const lastCheck = finished.filter(r => r.action === 'check_change' && r.allowed === true).at(-1);

  return {
    services: [
      { serviceId: 'orders', label: 'Orders', owner: SEED_STRUCTURE.owners.orders, source: 'seed' },
      { serviceId: 'billing', label: 'Billing', owner: SEED_STRUCTURE.owners.billing, source: 'seed' },
    ],
    surfaces: [
      { surfaceId: RECORDED_SURFACE_ID, serviceId: 'orders', label: 'quoteTotal() monetary unit',
        detail: `contract ${SEED_STRUCTURE.contract}`, revision: currentRevision, source: 'recorded' },
      { surfaceId: RECORDED_RULE_ID, serviceId: 'orders', label: 'Coordination rule (policyEpoch)',
        detail: 'consumer acknowledgement rule', revision: ruleEpoch, source: 'recorded' },
    ],
    dependencies: [
      { dependencyId: SEED_STRUCTURE.dependencyId, surfaceId: RECORDED_SURFACE_ID, consumerServiceId: 'billing',
        verifiedRevision: lastAck?.dependencyRevision ?? null, verifiedEpoch: lastAck?.policyEpoch ?? null, source: 'recorded' },
      { dependencyId: RECORDED_RULE_DEP, surfaceId: RECORDED_RULE_ID, consumerServiceId: 'orders',
        verifiedRevision: lastCheck?.policyEpoch ?? null, verifiedEpoch: lastCheck?.policyEpoch ?? null, source: 'recorded' },
    ],
    runs, changes,
  };
}

export function mergeInputs(...inputs: GraphInput[]): GraphInput {
  return { services: inputs.flatMap(i => i.services), surfaces: inputs.flatMap(i => i.surfaces),
    dependencies: inputs.flatMap(i => i.dependencies), runs: inputs.flatMap(i => i.runs), changes: inputs.flatMap(i => i.changes) };
}
