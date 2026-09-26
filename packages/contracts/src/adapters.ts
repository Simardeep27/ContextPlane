import type {
  CandidateHash,
  ChangeCheckVersion,
  EventEnvelope,
  OperationKey,
  OperationReceipt,
  ProjectProjection,
  ProjectScope,
  RunCheckpoint,
  RunId,
} from "./contracts.js";
import type { RecordKind, RecordOf, RecordWrite } from "./records.js";
import type { AgentContextPacket, ToolDefinition } from "./tools.js";

/**
 * Fencing token for one run. Scope is part of the token so a lease can never
 * be replayed against another project even when run IDs and generations match.
 * Pass back the entire token returned by `acquireLease`/`renewLease`.
 */
export interface LeaseToken {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly generation: number;
  readonly expiresAt: string;
}

/**
 * One worker step committed atomically: all parts land or none do. When
 * `candidateHash` is set, every record in the step that names a candidate
 * must name this one.
 */
export interface CommitStep {
  readonly checkpoint: RunCheckpoint;
  readonly lease: LeaseToken;
  readonly event?: EventEnvelope;
  readonly receipt?: OperationReceipt;
  readonly projection?: { readonly value: ProjectProjection; readonly expectedRevision: number };
  readonly records?: readonly RecordWrite[];
  readonly candidateHash?: CandidateHash;
}

export interface PersistenceAdapter {
  /** Trusted API ingestion only; worker effects go through `commitStep`. */
  appendEvent(event: EventEnvelope): Promise<void>;
  readEvents(scope: ProjectScope, afterCursor?: string): Promise<readonly EventEnvelope[]>;
  readProjection(scope: ProjectScope): Promise<ProjectProjection | null>;
  /** Compare-and-set on the stored projection revision (0 when none). */
  saveProjection(projection: ProjectProjection, expectedRevision: number): Promise<void>;
  readCheckpoint(scope: ProjectScope, runId: RunId): Promise<RunCheckpoint | null>;
  saveCheckpoint(checkpoint: RunCheckpoint, lease: LeaseToken): Promise<void>;
  readReceipt(scope: ProjectScope, operationKey: OperationKey): Promise<OperationReceipt | null>;
  saveReceipt(receipt: OperationReceipt, lease: LeaseToken): Promise<void>;
  acquireLease(scope: ProjectScope, runId: RunId): Promise<LeaseToken | null>;
  renewLease(scope: ProjectScope, lease: LeaseToken): Promise<LeaseToken | null>;
  commitStep(step: CommitStep): Promise<void>;
  /** Trusted API/seed write of one record; worker writes go through `commitStep`. */
  saveRecord(write: RecordWrite): Promise<void>;
  readRecord<Kind extends RecordKind>(scope: ProjectScope, kind: Kind, recordId: string): Promise<RecordOf<Kind> | null>;
  /** Up to 100 records of one kind, ordered by recordId. */
  listRecords<Kind extends RecordKind>(scope: ProjectScope, kind: Kind): Promise<readonly RecordOf<Kind>[]>;
}

export interface ModelTurnRequest {
  readonly context: AgentContextPacket;
  readonly tools: readonly ToolDefinition[];
}

export interface ModelTurnResult {
  readonly provider: "openrouter";
  readonly model: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly content: string | null;
  readonly toolCalls: readonly unknown[];
}

export interface ModelAdapter {
  completeTurn(request: ModelTurnRequest): Promise<ModelTurnResult>;
}

export interface RunnerRequest {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly operationKey: OperationKey;
  readonly candidateHash: CandidateHash;
  readonly registeredCommand: string;
}

export interface RunnerReceipt {
  readonly operationKey: OperationKey;
  readonly candidateHash: CandidateHash;
  readonly passed: boolean;
  readonly evidenceIds: readonly string[];
}

export interface RunnerAdapter {
  runRegistered(request: RunnerRequest): Promise<RunnerReceipt>;
  reconcile(operationKey: OperationKey): Promise<RunnerReceipt | null>;
}

export interface EvaluationRequest {
  readonly version: ChangeCheckVersion;
  readonly datasetHash: string;
  readonly candidateRule: unknown;
}

export interface EvaluationResult {
  readonly datasetHash: string;
  readonly candidateHash: CandidateHash;
  readonly unsafeCasesCaught: number;
  readonly validCasesBlocked: number;
  readonly evidenceIds: readonly string[];
}

export interface EvaluatorAdapter {
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>;
}
