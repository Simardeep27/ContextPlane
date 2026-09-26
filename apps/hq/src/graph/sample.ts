/**
 * SAMPLE fixtures. These services, surfaces, runs and changes are invented to show the
 * view at density. They are not recorded evidence and not live data; every record has
 * `source: 'sample'` and the UI labels each row SAMPLE.
 */
import type { GraphChange, GraphInput, GraphRun, RunOutcome } from '../../shared/graph.ts';

const T0 = Date.parse('2026-01-01T12:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

type SurfaceSpec = { id: string; label: string; detail: string; revision: number;
  history: [number, string, string][]; consumers: [string, number][] };
const spec: { service: string; label: string; owner: string; surfaces: SurfaceSpec[] }[] = [
  { service: 'inventory', label: 'Inventory', owner: 'sample_agent_inventory', surfaces: [
    { id: 'get-stock', label: 'GET /stock/:sku', detail: 'REST response', revision: 12,
      history: [[11, 'sample_agent_inventory', 'Add reservedQty field'], [12, 'sample_agent_inventory', 'Rename qty → onHand']],
      consumers: [['orders', 12], ['shipping', 11]] },
    { id: 'stock-reserved', label: 'stock.reserved event', detail: 'event payload', revision: 4,
      history: [[4, 'sample_agent_inventory', 'Include warehouseId']], consumers: [['notifications', 4]] },
  ] },
  { service: 'payments', label: 'Payments', owner: 'sample_agent_payments', surfaces: [
    { id: 'post-charges', label: 'POST /charges', detail: 'REST request/response', revision: 5,
      history: [[4, 'sample_agent_payments', 'Idempotency key required'], [5, 'sample_agent_payments', 'Currency becomes ISO 4217 code']],
      consumers: [['orders', 5], ['billing-sample', 3]] },
    { id: 'refund-webhook', label: 'refund.completed webhook', detail: 'webhook body', revision: 2,
      history: [[2, 'sample_agent_payments', 'Add reason code']], consumers: [['notifications', 2]] },
  ] },
  { service: 'shipping', label: 'Shipping', owner: 'sample_agent_shipping', surfaces: [
    { id: 'get-rates', label: 'GET /rates', detail: 'REST response', revision: 9,
      history: [[9, 'sample_agent_shipping', 'Add carrier ETA']], consumers: [['orders', 9]] },
  ] },
  { service: 'search', label: 'Search', owner: 'sample_agent_search', surfaces: [
    { id: 'index-schema', label: 'product index schema', detail: 'index mapping', revision: 3,
      history: [[3, 'sample_agent_search', 'Tokenize SKU prefixes']], consumers: [['inventory', 3], ['orders', 2]] },
  ] },
];
const consumerLabel: Record<string, string> = { orders: 'Orders', shipping: 'Shipping', notifications: 'Notifications',
  'billing-sample': 'Billing (sample)', inventory: 'Inventory' };

export function sampleGraph(): GraphInput {
  const out: GraphInput = { services: [], surfaces: [], dependencies: [], runs: [], changes: [] };
  const seenConsumer = new Set<string>();
  let clock = 0;
  for (const svc of spec) {
    out.services.push({ serviceId: `sample:${svc.service}`, label: svc.label, owner: svc.owner, source: 'sample' });
    for (const s of svc.surfaces) {
      const surfaceId = `sample:${svc.service}:${s.id}`;
      out.surfaces.push({ surfaceId, serviceId: `sample:${svc.service}`, label: s.label, detail: s.detail, revision: s.revision, source: 'sample' });
      for (const [rev, actor, summary] of s.history) {
        clock += 7;
        out.changes.push({ changeId: `${surfaceId}:r${rev}`, nodeId: surfaceId, at: at(clock), actor, summary,
          fromRevision: rev - 1, toRevision: rev, kind: 'publication', hash: null, source: 'sample' } satisfies GraphChange);
      }
      s.consumers.forEach(([consumer, verified], i) => {
        const dependencyId = `sample_${svc.service}_${s.id}_${consumer}`;
        seenConsumer.add(consumer);
        out.dependencies.push({ dependencyId, surfaceId, consumerServiceId: `sample-consumer:${consumer}`,
          verifiedRevision: verified, verifiedEpoch: null, source: 'sample' });
        const outcomes: RunOutcome[] = verified < s.revision ? ['passed', verified + 1 < s.revision ? 'blocked' : 'failed'] : ['passed', 'passed'];
        outcomes.forEach((outcome, k) => {
          const start = clock - 10 + k * 9 + i * 3;
          out.runs.push({ runId: `sample-run-${svc.service}-${s.id}-${consumer}-${k + 1}`, nodeId: dependencyId,
            dependencyRevision: k === 0 ? Math.max(1, verified - 1) : verified, policyEpoch: null,
            startedAt: at(start), finishedAt: at(start + 3 + k), agent: `sample_agent_${consumer.replace('-sample', '')}`,
            outcome, reasons: outcome === 'blocked' ? ['stale_dependency_revision'] : [], hash: null, source: 'sample' } satisfies GraphRun);
        });
      });
    }
  }
  // Consumer-only services carry labels; buildTree omits services without surfaces as roots.
  return { ...out, services: [...out.services, ...[...seenConsumer].map(c => ({ serviceId: `sample-consumer:${c}`,
    label: consumerLabel[c] ?? c, owner: null, source: 'sample' as const }))] };
}
