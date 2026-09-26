// SAMPLE DATA ONLY: a fictional larger org used to show the product at scale. Never mixed with live reads.
import type { TeamAgent, TeamEvent, TeamSnapshot } from './team.ts';
export const samplePeople = [
  { key: 'maya', name: 'Maya Chen', team: 'Platform' },
  { key: 'dev', name: 'Dev Patel', team: 'Platform' },
  { key: 'lena', name: 'Lena Okafor', team: 'Payments' },
  { key: 'arjun', name: 'Arjun Rao', team: 'Payments' },
  { key: 'sofia', name: 'Sofia Reyes', team: 'Growth' },
  { key: 'kai', name: 'Kai Nakamura', team: 'Growth' },
] as const;
export const sampleOrder = samplePeople.map(p => p.name);
export const samplePersonOf = (identity: string) => samplePeople.find(p => p.key === identity.split(':')[0])?.name ?? 'Other';
export const sampleTeamOf = (name: string) => samplePeople.find(p => p.name === name)?.team ?? '';
type Row = [identity: string, status: string, task: string, summary: string, files: string[], minAgo: number];
const rows: Row[] = [
  ['maya:gateway', 'working', 'Rate-limit the public gateway', 'Adding token-bucket middleware', ['services/gateway/src/limits.ts'], 1],
  ['maya:k8s', 'working', 'Upgrade cluster ingress', 'Rolling ingress to canary pool', ['infra/k8s/ingress/values.yaml'], 3],
  ['maya:docs', 'idle', 'Runbook refresh', 'Turn stopped; waiting for review', ['docs/runbooks/gateway.md'], 22],
  ['dev:observability', 'working', 'Trace sampling for checkout', 'Wiring OpenTelemetry spans', ['services/checkout/src/tracing.ts'], 2],
  ['dev:gateway-auth', 'working', 'Gateway auth refactor', 'Moving token checks into middleware', ['services/gateway/src/limits.ts', 'services/gateway/src/auth.ts'], 1],
  ['lena:orders-units', 'working', 'Orders API returns dollars (#212)', 'Changing amount fields from cents to dollars', ['services/orders/src/money.ts'], 1],
  ['lena:ledger', 'done', 'Ledger reconciliation job', 'Nightly reconciliation shipped and verified', ['services/ledger/src/reconcile.ts'], 9],
  ['lena:fraud', 'blocked', 'Fraud rule backtest', 'Needs read access to the risk warehouse', [], 6],
  ['arjun:billing', 'working', 'Billing consumes Orders amounts (#212)', 'Updating invoice math for new units', ['services/billing/src/invoice.ts'], 2],
  ['arjun:refunds', 'working', 'Refund idempotency keys', 'Adding operation keys to refund API', ['services/refunds/src/api.ts'], 4],
  ['sofia:onboarding', 'working', 'Onboarding checklist A/B', 'Variant B copy and events', ['apps/web/src/onboarding/Checklist.tsx'], 2],
  ['sofia:email', 'done', 'Welcome email templates', 'Handed templates to lifecycle team', ['apps/email/templates/welcome.mjml'], 14],
  ['sofia:pricing', 'working', 'Pricing page experiment', 'Adding annual toggle', ['apps/web/src/pricing/Plans.tsx'], 5],
  ['kai:notifications', 'working', 'Notify on refund status', 'Subscribing to refund events', ['services/notifications/src/refunds.ts'], 3],
  ['kai:onboarding-events', 'working', 'Onboarding analytics', 'Instrumenting checklist steps', ['apps/web/src/onboarding/events.ts'], 1],
];
export function sampleSnapshot(now = Date.now()): TeamSnapshot {
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  const agents: TeamAgent[] = rows.map(([identity, status, task, summary, files, minAgo], i) => ({
    identity, person: samplePersonOf(identity), instanceId: null, task, currentTask: summary, status,
    blockedOn: status === 'blocked' ? [summary] : [], nextAction: null, files, evidence: [],
    reportedAt: at(minAgo), publishedAt: at(minAgo), revision: i + 1 }));
  const events: TeamEvent[] = [];
  rows.forEach(([identity, status, task, summary, files, minAgo]) => {
    for (let k = 3; k >= 1; k--) events.push({ type: k === 3 ? 'work_started' : 'progress', actor: identity, task, summary, files, occurredAt: at(minAgo + k * 7) });
    events.push({ type: status === 'done' ? 'work_finished' : status === 'blocked' ? 'blocked' : 'progress', actor: identity, task, summary, files, occurredAt: at(minAgo),
      ...(status === 'idle' ? { waiting: true } : {}) });
  });
  events.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  return { fetchedAt: new Date(now).toISOString(), agents, events, possiblyTruncated: false };
}
