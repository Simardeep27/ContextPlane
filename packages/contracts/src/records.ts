import type {
  AgentId,
  Brand,
  CandidateHash,
  ChangeCheckVersion,
  EvidenceId,
  OperationKey,
  ProjectScope,
  UserId,
} from "./contracts.js";

export type ServiceId = Brand<string, "ServiceId">;
export type ArtifactHash = Brand<string, "ArtifactHash">;
export type PolicyCandidateHash = Brand<string, "PolicyCandidateHash">;
export type DatasetHash = Brand<string, "DatasetHash">;

/**
 * Durable domain records for the dependency-coordination flow. Every record is
 * project-scoped and carries its own compare-and-set `revision` (1 on first
 * write). Core decides the contents; persistence only enforces scope,
 * revision order, immutability, and the version guards noted per record.
 */
interface RecordBase<Kind extends string> {
  readonly kind: Kind;
  readonly scope: ProjectScope;
  readonly recordId: string;
  readonly revision: number;
  readonly recordedAt: string;
  readonly evidenceIds: readonly EvidenceId[];
}

/**
 * Authoritative head of a producer's published contract. Keyed by service;
 * each update must advance `dependencyRevision` by exactly one.
 */
export interface DependencyRevisionRecord extends RecordBase<"dependency_revision"> {
  readonly serviceId: ServiceId;
  readonly dependencyRevision: number;
  readonly artifactHash: ArtifactHash;
  readonly publishedBy: AgentId;
  readonly consumers: readonly ServiceId[];
}

export type CandidateStatus =
  | "proposed"
  | "stale"
  | "staged"
  | "checked"
  | "authorized"
  | "published"
  | "rejected";

/** Keyed by candidate hash. `basedOn` may lag the head (stale) but never lead it. */
export interface CandidateRecord extends RecordBase<"candidate"> {
  readonly candidateHash: CandidateHash;
  readonly serviceId: ServiceId;
  readonly authorAgentId: AgentId;
  readonly dependencyServiceId: ServiceId;
  readonly basedOn: ChangeCheckVersion;
  readonly artifactHashes: readonly ArtifactHash[];
  readonly status: CandidateStatus;
  readonly reasonCodes: readonly string[];
}

/** Immutable result of one registered check against one exact candidate. */
export interface CheckResultRecord extends RecordBase<"check_result"> {
  readonly candidateHash: CandidateHash;
  readonly registeredCommand: string;
  readonly operationKey: OperationKey;
  readonly version: ChangeCheckVersion;
  readonly passed: boolean;
  readonly artifactHashes: readonly ArtifactHash[];
}

/**
 * Immutable publication decision, keyed by candidate hash. An `authorized`
 * decision must match the current dependency head and policy epoch.
 */
export interface PublicationAuthorizationRecord extends RecordBase<"publication_authorization"> {
  readonly candidateHash: CandidateHash;
  readonly dependencyServiceId: ServiceId;
  readonly version: ChangeCheckVersion;
  readonly decision: "authorized" | "rejected";
  readonly checkResultIds: readonly string[];
  readonly acknowledgedBy: readonly AgentId[];
  readonly reasonCodes: readonly string[];
}

/** Restricted, non-executable coordination rule. */
export interface CoordinationRule {
  readonly type: "require_ack_before_stage";
  readonly whenDependencyServiceId: ServiceId;
  readonly whenDependencyAdvancedPastBase: true;
  readonly requireAckFrom: AgentId;
}

export interface PolicyEvaluationSummary {
  readonly datasetHash: DatasetHash;
  readonly unsafeCasesTotal: number;
  readonly unsafeCasesCaught: number;
  readonly validCasesTotal: number;
  readonly validCasesBlocked: number;
}

export interface PolicyCandidateRecord extends RecordBase<"policy_candidate"> {
  readonly policyCandidateHash: PolicyCandidateHash;
  readonly targetAgentId: AgentId;
  readonly rule: CoordinationRule;
  readonly sourceCandidateHash: CandidateHash;
  readonly status: "proposed" | "evaluated" | "rejected" | "promoted";
  readonly evaluation: PolicyEvaluationSummary | null;
}

/** Immutable promoted policy, keyed by `${targetAgentId}@${policyEpoch}`. */
export interface PolicyVersionRecord extends RecordBase<"policy_version"> {
  readonly targetAgentId: AgentId;
  readonly policyEpoch: number;
  readonly policyCandidateHash: PolicyCandidateHash;
  readonly rules: readonly CoordinationRule[];
  readonly evaluation: PolicyEvaluationSummary;
  readonly promotedBy: UserId;
}

export type ContextRecord =
  | DependencyRevisionRecord
  | CandidateRecord
  | CheckResultRecord
  | PublicationAuthorizationRecord
  | PolicyCandidateRecord
  | PolicyVersionRecord;

export type RecordKind = ContextRecord["kind"];
export type RecordOf<Kind extends RecordKind> = Extract<ContextRecord, { kind: Kind }>;

export const recordKinds = [
  "dependency_revision",
  "candidate",
  "check_result",
  "publication_authorization",
  "policy_candidate",
  "policy_version",
] as const satisfies readonly RecordKind[];

/** Evidence records are written once; an identical retry is a no-op. */
export const immutableRecordKinds: readonly RecordKind[] = [
  "check_result",
  "publication_authorization",
  "policy_version",
];

/** Compare-and-set write: `expectedRevision` is the stored record's revision (0 if new). */
export interface RecordWrite<Record extends ContextRecord = ContextRecord> {
  readonly record: Record;
  readonly expectedRevision: number;
}

export type StaleReason =
  | "STALE_DEPENDENCY_REVISION"
  | "FUTURE_DEPENDENCY_REVISION"
  | "STALE_POLICY_EPOCH"
  | "FUTURE_POLICY_EPOCH"
  | "CANDIDATE_HASH_MISMATCH";

/** Authoritative values a candidate's version tuple is checked against. */
export interface AuthoritativeVersion {
  readonly candidateHash: CandidateHash;
  readonly dependencyRevision: number;
  readonly policyEpoch: number;
}

/** Empty result means the tuple is current. Order is stable for evidence. */
export function staleVersionReasons(
  version: ChangeCheckVersion,
  current: AuthoritativeVersion,
): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (version.candidateHash !== current.candidateHash) reasons.push("CANDIDATE_HASH_MISMATCH");
  if (version.dependencyRevision < current.dependencyRevision) reasons.push("STALE_DEPENDENCY_REVISION");
  if (version.dependencyRevision > current.dependencyRevision) reasons.push("FUTURE_DEPENDENCY_REVISION");
  if (version.policyEpoch < current.policyEpoch) reasons.push("STALE_POLICY_EPOCH");
  if (version.policyEpoch > current.policyEpoch) reasons.push("FUTURE_POLICY_EPOCH");
  return reasons;
}
