import type {
  AccessRequestId,
  AgentId,
  EventEnvelope,
  EvidenceId,
  EventId,
  OperationKey,
  OperationReceipt,
  OrgId,
  ProjectId,
  ProjectProjection,
  RunCheckpoint,
  RunId,
  UserId,
} from "../contracts.js";

const scope = {
  orgId: "org_demo" as OrgId,
  projectId: "project_context_plane" as ProjectId,
} as const;

const runId = "run_access_001" as RunId;
const ordersAgentId = "agent_orders" as AgentId;
const pmUserId = "user_pm" as UserId;
const accessRequestId = "access_001" as AccessRequestId;
const queryOperationKey = "run_access_001:query_demo_orders:1" as OperationKey;
const protectedReadEvidence = "evidence_protected_read_001" as EvidenceId;

const systemActor = { kind: "system", id: "system", role: "system" } as const;
const ordersActor = { kind: "agent", id: ordersAgentId, role: "orders" } as const;
const pmActor = { kind: "human", id: pmUserId, role: "pm" } as const;

export const blockedResumedCompletedEvents = [
  {
    eventId: "event_001" as EventId,
    type: "run.blocked",
    scope,
    runId,
    actor: ordersActor,
    revision: 1,
    cursor: "000001",
    occurredAt: "2026-09-26T14:00:00.000Z",
    payload: { reason: "Missing demo.staging.orders:read access", accessRequestId },
  },
  {
    eventId: "event_002" as EventId,
    type: "access.decided",
    scope,
    runId,
    actor: pmActor,
    revision: 2,
    cursor: "000002",
    occurredAt: "2026-09-26T14:01:00.000Z",
    payload: { accessRequestId, decision: "approved", requestRevision: 1 },
  },
  {
    eventId: "event_003" as EventId,
    type: "run.resumed",
    scope,
    runId,
    actor: systemActor,
    revision: 3,
    cursor: "000003",
    occurredAt: "2026-09-26T14:01:01.000Z",
    payload: { accessRequestId, leaseGeneration: 2 },
  },
  {
    eventId: "event_004" as EventId,
    type: "run.completed",
    scope,
    runId,
    actor: ordersActor,
    revision: 4,
    cursor: "000004",
    occurredAt: "2026-09-26T14:01:03.000Z",
    payload: { operationKey: queryOperationKey, evidenceIds: [protectedReadEvidence] },
  },
] as const satisfies readonly EventEnvelope[];

const timeline = blockedResumedCompletedEvents.map((event) => ({
  eventId: event.eventId,
  cursor: event.cursor,
  type: event.type,
  summary: event.type,
  evidenceIds:
    event.type === "run.completed" ? ([protectedReadEvidence] as const) : [],
}));

export const blockedResumedCompletedProjections = [
  {
    scope,
    revision: 1,
    eventCursor: "000001",
    policyEpoch: 1,
    runs: [{
      runId,
      ownerAgentId: ordersAgentId,
      status: "blocked",
      summary: "Orders staging verification needs scoped read access.",
      blocker: "Missing demo.staging.orders:read access",
      checkpointRevision: 1,
      evidenceIds: [],
    }],
    accessRequests: [{
      accessRequestId,
      requesterAgentId: ordersAgentId,
      resource: "demo.staging.orders",
      action: "read",
      purpose: "Verify the staged Orders change",
      requestHash: "sha256:access-request-001",
      status: "pending",
      ownerUserId: pmUserId,
      expiresAt: "2026-09-26T14:16:00.000Z",
      revision: 1,
    }],
    timeline: timeline.slice(0, 1),
  },
  {
    scope,
    revision: 3,
    eventCursor: "000003",
    policyEpoch: 1,
    runs: [{
      runId,
      ownerAgentId: ordersAgentId,
      status: "running",
      summary: "Access approved; protected verification resumed.",
      blocker: null,
      checkpointRevision: 2,
      evidenceIds: [],
    }],
    accessRequests: [{
      accessRequestId,
      requesterAgentId: ordersAgentId,
      resource: "demo.staging.orders",
      action: "read",
      purpose: "Verify the staged Orders change",
      requestHash: "sha256:access-request-001",
      status: "approved",
      ownerUserId: pmUserId,
      expiresAt: "2026-09-26T14:16:00.000Z",
      revision: 2,
    }],
    timeline: timeline.slice(0, 3),
  },
  {
    scope,
    revision: 4,
    eventCursor: "000004",
    policyEpoch: 1,
    runs: [{
      runId,
      ownerAgentId: ordersAgentId,
      status: "completed",
      summary: "Protected Orders verification completed.",
      blocker: null,
      checkpointRevision: 3,
      evidenceIds: [protectedReadEvidence],
    }],
    accessRequests: [{
      accessRequestId,
      requesterAgentId: ordersAgentId,
      resource: "demo.staging.orders",
      action: "read",
      purpose: "Verify the staged Orders change",
      requestHash: "sha256:access-request-001",
      status: "approved",
      ownerUserId: pmUserId,
      expiresAt: "2026-09-26T14:16:00.000Z",
      revision: 2,
    }],
    timeline,
  },
] as const satisfies readonly ProjectProjection[];

export const completedCheckpoint = {
  scope,
  runId,
  checkpointId: "checkpoint_003",
  revision: 3,
  leaseGeneration: 2,
  status: "completed",
  lastEventCursor: "000004",
  nextAction: null,
  completedOperationKeys: [queryOperationKey],
  updatedAt: "2026-09-26T14:01:03.000Z",
} as const satisfies RunCheckpoint;

export const protectedReadReceipt = {
  scope,
  runId,
  operationKey: queryOperationKey,
  kind: "query_demo_orders",
  status: "succeeded",
  attempt: 1,
  leaseGeneration: 2,
  evidenceIds: [protectedReadEvidence],
  resultHash: "sha256:protected-read-result-001",
  startedAt: "2026-09-26T14:01:01.000Z",
  completedAt: "2026-09-26T14:01:02.000Z",
} as const satisfies OperationReceipt;
