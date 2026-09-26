export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type OrgId = Brand<string, "OrgId">;
export type ProjectId = Brand<string, "ProjectId">;
export type RunId = Brand<string, "RunId">;
export type EventId = Brand<string, "EventId">;
export type CommandId = Brand<string, "CommandId">;
export type UserId = Brand<string, "UserId">;
export type AgentId = Brand<string, "AgentId">;
export type AccessRequestId = Brand<string, "AccessRequestId">;
export type OperationKey = Brand<string, "OperationKey">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type CandidateHash = Brand<string, "CandidateHash">;

export interface ProjectScope {
  readonly orgId: OrgId;
  readonly projectId: ProjectId;
}

export interface ActorRef {
  readonly kind: "human" | "agent" | "system";
  readonly id: UserId | AgentId | "system";
  readonly role: "pm" | "orders" | "billing" | "notifications" | "system";
}

export interface CommandEnvelope<
  Type extends string = string,
  Payload = unknown,
> {
  readonly commandId: CommandId;
  readonly type: Type;
  readonly scope: ProjectScope;
  readonly runId?: RunId;
  readonly actor: ActorRef;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly payload: Payload;
}

export interface EventEnvelope<
  Type extends string = string,
  Payload = unknown,
> {
  readonly eventId: EventId;
  readonly type: Type;
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly actor: ActorRef;
  readonly revision: number;
  readonly cursor: string;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export type RunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed";

export interface ChangeCheckVersion {
  readonly candidateHash: CandidateHash;
  readonly dependencyRevision: number;
  readonly policyEpoch: number;
}

export interface RunCheckpoint {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly checkpointId: string;
  readonly revision: number;
  readonly leaseGeneration: number;
  readonly status: RunStatus;
  readonly lastEventCursor: string;
  readonly nextAction: string | null;
  readonly completedOperationKeys: readonly OperationKey[];
  readonly updatedAt: string;
}

export interface OperationReceipt {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly operationKey: OperationKey;
  readonly kind: string;
  readonly status: "started" | "succeeded" | "failed";
  readonly attempt: number;
  readonly leaseGeneration: number;
  readonly evidenceIds: readonly EvidenceId[];
  readonly resultHash?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface AccessRequestProjection {
  readonly accessRequestId: AccessRequestId;
  readonly requesterAgentId: AgentId;
  readonly resource: string;
  readonly action: string;
  readonly purpose: string;
  readonly requestHash: string;
  readonly status: "pending" | "approved" | "denied" | "revoked" | "expired";
  readonly ownerUserId: UserId;
  readonly expiresAt: string;
  readonly revision: number;
}

export interface RunProjection {
  readonly runId: RunId;
  readonly ownerAgentId: AgentId;
  readonly status: RunStatus;
  readonly summary: string;
  readonly blocker: string | null;
  readonly checkpointRevision: number;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface TimelineEntry {
  readonly eventId: EventId;
  readonly cursor: string;
  readonly type: string;
  readonly summary: string;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface ProjectProjection {
  readonly scope: ProjectScope;
  readonly revision: number;
  readonly eventCursor: string;
  readonly policyEpoch: number;
  readonly runs: readonly RunProjection[];
  readonly accessRequests: readonly AccessRequestProjection[];
  readonly timeline: readonly TimelineEntry[];
}
