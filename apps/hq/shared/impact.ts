/**
 * Transitive impact over the graph the page already shows (seed, recorded, sample). This is the
 * fallback for the live `$graphLookup` route (`GET /v1/projects/:id/impact`, apps/api) and mirrors
 * its semantics: provider -> consumer edges, visited-set cycle guard, at most 5 hops.
 */
import type { GraphInput, GraphSource } from './graph.ts';

export const IMPACT_MAX_DEPTH = 5;
export interface ImpactHit { serviceKey: string; depth: number; path: string[] }
export interface Impact { surfaceId: string; source: GraphSource | 'mixed'; hits: Map<string, ImpactHit> }

/** Sample consumers use a `sample-consumer:` prefix for the same service that provides `sample:` surfaces. */
export const serviceKey = (id: string) => id.replace(/^sample-consumer:/, 'sample:');

export function impactOf(input: GraphInput, surfaceId: string, maxDepth = IMPACT_MAX_DEPTH): Impact {
  const surfaces = new Map(input.surfaces.map(s => [s.surfaceId, s]));
  const start = surfaces.get(surfaceId);
  const hits = new Map<string, ImpactHit>();
  const sources = new Set<GraphSource>();
  if (!start) return { surfaceId, source: 'sample', hits };
  const provider = serviceKey(start.serviceId);
  const consumersOf = (surfaceIds: string[]) => input.dependencies.filter(d => surfaceIds.includes(d.surfaceId));
  const surfacesOf = (service: string) => input.surfaces.filter(s => serviceKey(s.serviceId) === service).map(s => s.surfaceId);
  const seen = new Set([provider]);
  let frontier: { service: string; path: string[]; surfaceIds: string[] }[] = [{ service: provider, path: [provider], surfaceIds: [surfaceId] }];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) for (const dep of consumersOf(node.surfaceIds)) {
      sources.add(dep.source);
      const key = serviceKey(dep.consumerServiceId);
      if (seen.has(key)) continue;
      seen.add(key);
      const path = [...node.path, key];
      hits.set(key, { serviceKey: key, depth, path });
      next.push({ service: key, path, surfaceIds: surfacesOf(key) });
    }
    frontier = next;
  }
  return { surfaceId, source: sources.size === 1 ? [...sources][0]! : sources.size ? 'mixed' : start.source, hits };
}
