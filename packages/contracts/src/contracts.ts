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
export type ArtifactHash = Brand<string, "ArtifactHash">;
export type DependencyId = Brand<string, "DependencyId">;
export type PolicyId = Brand<string, "PolicyId">;
export type PolicyHash = Brand<string, "PolicyHash">;
export type CheckResultId = Brand<string, "CheckResultId">;

export interface ProjectScope<
  Org extends OrgId = OrgId,
  Project extends ProjectId = ProjectId,
> {
  readonly orgId: Org;
  readonly projectId: Project;
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
  Version extends ChangeCheckVersion = ChangeCheckVersion,
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
  /** Present for events that make a decision about an exact candidate. */
  readonly candidateVersion?: Version;
}

export type RunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed";

export interface ChangeCheckVersion<
  Candidate extends CandidateHash = CandidateHash,
  DependencyRevision extends number = number,
  PolicyEpoch extends number = number,
> {
  readonly candidateHash: Candidate;
  readonly dependencyRevision: DependencyRevision;
  readonly policyEpoch: PolicyEpoch;
}

export interface RunCheckpoint<
  Version extends ChangeCheckVersion = ChangeCheckVersion,
  Scope extends ProjectScope = ProjectScope,
> {
  readonly scope: Scope;
  readonly runId: RunId;
  readonly checkpointId: string;
  readonly revision: number;
  readonly leaseGeneration: number;
  readonly status: RunStatus;
  readonly lastEventCursor: string;
  readonly nextAction: string | null;
  readonly completedOperationKeys: readonly OperationKey[];
  readonly updatedAt: string;
  /** Present while this checkpoint is advancing a candidate workflow. */
  readonly candidateVersion?: Version;
}

export interface OperationReceipt<Version extends ChangeCheckVersion = ChangeCheckVersion> {
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
  /** Present when the effect operates on an exact candidate. */
  readonly candidateVersion?: Version;
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

export interface ProjectProjection<Version extends ChangeCheckVersion = ChangeCheckVersion> {
  readonly scope: ProjectScope;
  readonly revision: number;
  readonly eventCursor: string;
  readonly policyEpoch: number;
  readonly runs: readonly RunProjection[];
  readonly accessRequests: readonly AccessRequestProjection[];
  readonly timeline: readonly TimelineEntry[];
  /** The exact candidate tuple represented by a candidate-specific snapshot. */
  readonly candidateVersion?: Version;
}

/** A bounded pointer to immutable evidence; large evidence bodies live elsewhere. */
export interface EvidenceReference {
  readonly evidenceId: EvidenceId;
  readonly kind: string;
  readonly contentHash: string;
}

/** An immutable publication of one dependency revision. */
export interface DependencyRevision {
  readonly scope: ProjectScope;
  readonly dependencyId: DependencyId;
  readonly revision: number;
  readonly artifactHash: ArtifactHash;
  readonly evidence: readonly EvidenceReference[];
  readonly publishedAt: string;
}

/** The exact artifact set staged for one candidate/version tuple. */
export interface StagedCandidate<Version extends ChangeCheckVersion = ChangeCheckVersion> {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly revision: number;
  readonly version: Version;
  readonly operationKey: OperationKey;
  readonly artifactHashes: readonly ArtifactHash[];
  readonly evidence: readonly EvidenceReference[];
  readonly stagedAt: string;
}

/** Deterministic registered-check evidence for one exact staged candidate. */
export interface CheckResult<Version extends ChangeCheckVersion = ChangeCheckVersion> {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly checkResultId: CheckResultId;
  readonly revision: number;
  readonly stagedCandidateRevision: number;
  readonly version: Version;
  readonly registeredChecks: readonly string[];
  readonly passed: boolean;
  readonly evidence: readonly EvidenceReference[];
  readonly completedAt: string;
}

/** Authorization to publish only the tuple checked at the named result revision. */
export interface PublicationAuthorization<Version extends ChangeCheckVersion = ChangeCheckVersion> {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly revision: number;
  readonly version: Version;
  readonly checkResultId: CheckResultId;
  readonly checkResultRevision: number;
  readonly evidence: readonly EvidenceReference[];
  readonly authorizedAt: string;
}

/** A restricted, non-executable policy proposed for deterministic evaluation. */
export interface PolicyCandidate {
  readonly scope: ProjectScope;
  readonly targetAgentId: AgentId;
  readonly policyHash: PolicyHash;
  readonly revision: number;
  readonly basePolicyEpoch: number;
  readonly datasetHash: string;
  readonly rule: Readonly<Record<string, unknown>>;
  readonly evidence: readonly EvidenceReference[];
  readonly proposedAt: string;
}

/** An immutable promoted policy version. Promotion advances the project epoch. */
export interface PolicyVersion {
  readonly scope: ProjectScope;
  readonly policyId: PolicyId;
  readonly targetAgentId: AgentId;
  readonly policyHash: PolicyHash;
  readonly revision: number;
  readonly policyEpoch: number;
  readonly datasetHash: string;
  readonly rule: Readonly<Record<string, unknown>>;
  readonly evidence: readonly EvidenceReference[];
  readonly promotedAt: string;
}
