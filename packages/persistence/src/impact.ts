import type { Db } from 'mongodb';

/** One provider -> consumer edge as stored in `cp_coordination_dependencies` (consumer `ownerIdentity` depends on `dependsOn`). */
export interface ImpactEdge { readonly dependencyId: string; readonly ownerIdentity: string; readonly dependsOn: string }
export interface ImpactScope { readonly orgId: string; readonly projectId: string; readonly coordinationScope: string }
export interface AffectedConsumer {
  readonly identity: string;
  /** Hops from the changed provider: 1 = direct consumer. */
  readonly depth: number;
  /** Shortest identity path, provider first, this consumer last. */
  readonly path: readonly string[];
  readonly dependencyIds: readonly string[];
}
export interface ImpactResult {
  readonly surface: string;
  readonly provider: string;
  readonly maxDepth: number;
  readonly consumers: readonly AffectedConsumer[];
}

export const IMPACT_MAX_DEPTH = 5;

/**
 * Shortest-path projection over edges already reached by $graphLookup. Visited-set BFS, so a
 * cycle (A -> B -> A) terminates and the changed provider never reports itself as affected.
 */
export function affectedFromEdges(provider: string, edges: readonly ImpactEdge[], maxDepth = IMPACT_MAX_DEPTH): AffectedConsumer[] {
  const byProvider = new Map<string, ImpactEdge[]>();
  for (const edge of edges) byProvider.set(edge.dependsOn, [...(byProvider.get(edge.dependsOn) ?? []), edge]);
  const seen = new Map<string, AffectedConsumer>([[provider, { identity: provider, depth: 0, path: [provider], dependencyIds: [] }]]);
  let frontier = [provider];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const from of frontier) {
      const parent = seen.get(from)!;
      for (const edge of [...(byProvider.get(from) ?? [])].sort((a, b) => a.dependencyId.localeCompare(b.dependencyId))) {
        if (seen.has(edge.ownerIdentity)) continue;
        seen.set(edge.ownerIdentity, { identity: edge.ownerIdentity, depth, path: [...parent.path, edge.ownerIdentity],
          dependencyIds: [...parent.dependencyIds, edge.dependencyId] });
        next.push(edge.ownerIdentity);
      }
    }
    frontier = next;
  }
  seen.delete(provider);
  return [...seen.values()].sort((a, b) => a.depth - b.depth || a.identity.localeCompare(b.identity));
}

/**
 * Read-only transitive impact: who breaks if `surface` changes. Resolves the surface's owner
 * (or treats `surface` as a provider identity), then follows provider -> consumer edges with
 * $graphLookup restricted to the same org, project and coordination scope, up to 5 hops.
 */
export async function impactOfChange(db: Db, scope: ImpactScope, surface: string,
  maxDepth = IMPACT_MAX_DEPTH): Promise<ImpactResult> {
  if (!surface || surface.length > 256) throw new TypeError('INVALID_INPUT');
  const depth = Math.min(Math.max(1, Math.trunc(maxDepth)), IMPACT_MAX_DEPTH);
  const restrict = { orgId: scope.orgId, projectId: scope.projectId, coordinationScope: scope.coordinationScope };
  const owned = await db.collection('cp_coordination_surfaces').findOne({ ...restrict, surfaceName: surface },
    { projection: { ownerIdentity: 1 } });
  const provider = typeof owned?.ownerIdentity === 'string' ? owned.ownerIdentity : surface;
  const [row] = await db.aggregate<{ edges: (ImpactEdge & { hop: number })[] }>([
    { $documents: [{ provider }] },
    { $graphLookup: { from: 'cp_coordination_dependencies', startWith: '$provider', connectFromField: 'ownerIdentity',
      connectToField: 'dependsOn', as: 'edges', maxDepth: depth - 1, depthField: 'hop', restrictSearchWithMatch: restrict } },
    { $project: { _id: 0, edges: { $map: { input: '$edges', as: 'e', in: {
      dependencyId: '$$e.dependencyId', ownerIdentity: '$$e.ownerIdentity', dependsOn: '$$e.dependsOn', hop: '$$e.hop' } } } } },
  ]).toArray();
  return { surface, provider, maxDepth: depth, consumers: affectedFromEdges(provider, row?.edges ?? [], depth) };
}
