import { createHash } from 'node:crypto';
import type {
  AgentId, ArtifactHash, CandidateHash, CandidateRecord, CommandEnvelope, CommandId, DatasetHash,
  DependencyRevisionRecord, EventEnvelope, EventId, EvidenceId, OrgId, ProjectId, ProjectProjection,
  ProjectScope, RunId, ServiceId, UserId,
} from '@context-plane/contracts';

/*
 * Deterministic Dev A / Dev B dependency scenario. Everything here is
 * synthetic and derived from constant inputs, so IDs and hashes are identical
 * on every run and machine. No credentials, real code, or real people.
 *
 *   Dev B (Orders) publishes the order-total contract N -> N+1.
 *   Dev A (Billing) is working on a candidate developed against N.
 *   The combined candidate adapts Billing to N+1 and is the one that passes.
 */

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const sha256 = (value: unknown) =>
  'sha256:' + createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

export const scope: ProjectScope = { orgId: 'org_demo' as OrgId, projectId: 'project_dev_coordination' as ProjectId };
/** Fixed clock for seeded evidence; ordering authority is the event cursor. */
export const seededAt = '2026-09-26T15:00:00.000Z';

export const identities = {
  devA: { userId: 'user_dev_a' as UserId, agentId: 'agent_billing' as AgentId, role: 'billing', displayName: 'Dev A (Billing)' },
  devB: { userId: 'user_dev_b' as UserId, agentId: 'agent_orders' as AgentId, role: 'orders', displayName: 'Dev B (Orders)' },
  approver: { userId: 'user_pm' as UserId, role: 'pm', displayName: 'Demo PM (policy approver)' },
} as const;

export const services = {
  producer: { serviceId: 'svc-orders-api' as ServiceId, owner: identities.devB.agentId },
  consumer: { serviceId: 'svc-billing' as ServiceId, owner: identities.devA.agentId },
} as const;
/** The single explicit dependency edge: Billing consumes the Orders order-total contract. */
export const dependencyEdge = { consumer: services.consumer.serviceId, producer: services.producer.serviceId,
  contract: 'OrderTotal' } as const;

export const revisionN = 7;
export const revisionNext = revisionN + 1;

const artifact = (path: string, content: string) => ({ path, content, artifactHash: sha256(content) as ArtifactHash });

export const artifacts = {
  ordersContractN: artifact('orders-api/contract/order-total.json',
    '{"OrderTotal":{"amount":"number"}}\n'),
  ordersContractNext: artifact('orders-api/contract/order-total.json',
    '{"OrderTotal":{"amount":{"value":"number","currency":"string"}}}\n'),
  billingStale: artifact('billing/src/invoice.ts',
    'export const invoiceTotal = (order) => ({ total: order.amount, currency: "USD", lateFee: 0 });\n'),
  billingCombined: artifact('billing/src/invoice.ts',
    'export const invoiceTotal = (order) => ({ total: order.amount.value, currency: order.amount.currency, lateFee: 0 });\n'),
} as const;

/** Candidate hash covers the service, its exact artifacts, and the contract it was built against. */
function candidateHashOf(serviceId: ServiceId, artifactHashes: readonly ArtifactHash[], dependencyArtifact: ArtifactHash) {
  return sha256({ serviceId, artifactHashes: [...artifactHashes].sort(), dependencyArtifact }) as CandidateHash;
}

export const candidates = {
  /** Dev A's work developed against N; must be rejected once N+1 is published. */
  stale: {
    candidateHash: candidateHashOf(services.consumer.serviceId, [artifacts.billingStale.artifactHash], artifacts.ordersContractN.artifactHash),
    dependencyRevision: revisionN,
    artifactHashes: [artifacts.billingStale.artifactHash],
    expectedCheck: { registeredCommand: 'billing:cross-service-contract', passed: false,
      failure: 'OrderTotal.amount is an object at revision 8; billing reads a number' },
  },
  /** The exact coordinated candidate expected to pass at N+1. */
  combined: {
    candidateHash: candidateHashOf(services.consumer.serviceId, [artifacts.billingCombined.artifactHash], artifacts.ordersContractNext.artifactHash),
    dependencyRevision: revisionNext,
    artifactHashes: [artifacts.billingCombined.artifactHash],
    expectedCheck: { registeredCommand: 'billing:cross-service-contract', passed: true, failure: null },
  },
} as const;

export const initialPolicyEpoch = 0;

export const evidence = {
  publishN: 'evidence_orders_publish_rev7' as EvidenceId,
  publishNext: 'evidence_orders_publish_rev8' as EvidenceId,
  candidateProposed: 'evidence_billing_candidate_rev7' as EvidenceId,
} as const;

/** Dev B's publication of N+1, not applied by the seed; the API ingests it (MVP-03). */
export const devBPublication: CommandEnvelope<'dependency.publish', {
  serviceId: ServiceId; dependencyRevision: number; artifactHash: ArtifactHash; artifactPath: string;
  consumers: ServiceId[]; evidenceId: EvidenceId;
}> = {
  commandId: 'command_publish_orders_rev8' as CommandId,
  type: 'dependency.publish',
  scope,
  actor: { kind: 'agent', id: identities.devB.agentId, role: 'orders' },
  expectedRevision: revisionN,
  idempotencyKey: 'publish:svc-orders-api:8:' + artifacts.ordersContractNext.artifactHash,
  issuedAt: '2026-09-26T15:05:00.000Z',
  payload: {
    serviceId: services.producer.serviceId,
    dependencyRevision: revisionNext,
    artifactHash: artifacts.ordersContractNext.artifactHash,
    artifactPath: artifacts.ordersContractNext.path,
    consumers: [services.consumer.serviceId],
    evidenceId: evidence.publishNext,
  },
};

export type PolicyCaseKind = 'unsafe' | 'safe' | 'unrelated';
export interface PolicyCase {
  readonly caseId: string;
  readonly kind: PolicyCaseKind;
  readonly description: string;
  readonly facts: {
    readonly serviceId: string;
    readonly dependencyServiceId: string | null;
    readonly baseRevision: number | null;
    readonly headRevision: number | null;
    readonly producerAcknowledged: boolean;
    readonly failure: 'contract_mismatch' | 'network_timeout' | null;
  };
  /** What a correct policy decides before staging. */
  readonly expected: 'require_ack' | 'allow';
}

/**
 * Frozen evaluation set for MVP-07. Unsafe cases must all be caught, safe
 * cases must never be blocked, and the unrelated failure must not produce a
 * promotable lesson.
 */
export const policyDataset: readonly PolicyCase[] = [
  { caseId: 'unsafe-stale-billing', kind: 'unsafe', expected: 'require_ack',
    description: 'Billing stages a change built on Orders N after Orders published N+1, without acknowledgement.',
    facts: { serviceId: 'svc-billing', dependencyServiceId: 'svc-orders-api', baseRevision: 7, headRevision: 8,
      producerAcknowledged: false, failure: 'contract_mismatch' } },
  { caseId: 'unsafe-held-out-refund', kind: 'unsafe', expected: 'require_ack',
    description: 'Held-out: a later Billing refund change also reads OrderTotal from an outdated base revision.',
    facts: { serviceId: 'svc-billing', dependencyServiceId: 'svc-orders-api', baseRevision: 8, headRevision: 9,
      producerAcknowledged: false, failure: null } },
  { caseId: 'safe-coordinated', kind: 'safe', expected: 'allow',
    description: 'The combined Billing candidate at N+1 with Orders acknowledgement.',
    facts: { serviceId: 'svc-billing', dependencyServiceId: 'svc-orders-api', baseRevision: 8, headRevision: 8,
      producerAcknowledged: true, failure: null } },
  { caseId: 'safe-current-base', kind: 'safe', expected: 'allow',
    description: 'A Billing change built on the current Orders revision; nothing advanced.',
    facts: { serviceId: 'svc-billing', dependencyServiceId: 'svc-orders-api', baseRevision: 7, headRevision: 7,
      producerAcknowledged: false, failure: null } },
  { caseId: 'unrelated-network-timeout', kind: 'unrelated', expected: 'allow',
    description: 'A Notifications check timed out on the network; no dependency changed.',
    facts: { serviceId: 'svc-notifications', dependencyServiceId: null, baseRevision: null, headRevision: null,
      producerAcknowledged: false, failure: 'network_timeout' } },
];
export const policyDatasetHash = sha256(policyDataset) as DatasetHash;

// ---- Seeded durable state (dependency head N, Dev A's candidate at N) ----

export const seededDependency: DependencyRevisionRecord = {
  kind: 'dependency_revision', scope, recordId: services.producer.serviceId, revision: 1, recordedAt: seededAt,
  evidenceIds: [evidence.publishN], serviceId: services.producer.serviceId, dependencyRevision: revisionN,
  artifactHash: artifacts.ordersContractN.artifactHash, publishedBy: identities.devB.agentId,
  consumers: [services.consumer.serviceId],
};

export const seededCandidate: CandidateRecord = {
  kind: 'candidate', scope, recordId: candidates.stale.candidateHash, revision: 1, recordedAt: seededAt,
  evidenceIds: [evidence.candidateProposed], candidateHash: candidates.stale.candidateHash,
  serviceId: services.consumer.serviceId, authorAgentId: identities.devA.agentId,
  dependencyServiceId: services.producer.serviceId,
  basedOn: { candidateHash: candidates.stale.candidateHash, dependencyRevision: revisionN, policyEpoch: initialPolicyEpoch },
  artifactHashes: candidates.stale.artifactHashes, status: 'proposed', reasonCodes: [],
};

const seedRunId = 'run_seed' as RunId;
export const seededEvents: readonly EventEnvelope[] = [
  { eventId: 'event_seed_001' as EventId, type: 'dependency.published', scope, runId: seedRunId,
    actor: { kind: 'agent', id: identities.devB.agentId, role: 'orders' }, revision: 1, cursor: '000001',
    occurredAt: seededAt, payload: { serviceId: services.producer.serviceId, dependencyRevision: revisionN,
      artifactHash: artifacts.ordersContractN.artifactHash, evidenceId: evidence.publishN } },
  { eventId: 'event_seed_002' as EventId, type: 'candidate.proposed', scope, runId: seedRunId,
    actor: { kind: 'agent', id: identities.devA.agentId, role: 'billing' }, revision: 2, cursor: '000002',
    occurredAt: seededAt, payload: { candidateHash: candidates.stale.candidateHash, basedOnRevision: revisionN,
      serviceId: services.consumer.serviceId, evidenceId: evidence.candidateProposed } },
];

export const seededProjection: ProjectProjection = {
  scope, revision: 1, eventCursor: '000002', policyEpoch: initialPolicyEpoch, runs: [], accessRequests: [],
  timeline: seededEvents.map(event => ({
    eventId: event.eventId, cursor: event.cursor, type: event.type,
    summary: event.type === 'dependency.published'
      ? `Dev B published Orders contract revision ${revisionN}`
      : `Dev A proposed a Billing candidate built on Orders revision ${revisionN}`,
    evidenceIds: event.type === 'dependency.published' ? [evidence.publishN] : [evidence.candidateProposed],
  })),
};
