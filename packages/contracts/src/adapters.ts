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
import type { AgentContextPacket, ToolDefinition } from "./tools.js";

export interface LeaseToken<Scope extends ProjectScope = ProjectScope> {
  readonly scope: Scope;
  readonly runId: RunId;
  readonly generation: number;
  readonly expiresAt: string;
}

export interface ProjectionWrite<Version extends ChangeCheckVersion = ChangeCheckVersion> {
  readonly value: ProjectProjection<Version>;
  readonly expectedRevision: number;
}

export interface CommitStep<
  Version extends ChangeCheckVersion = ChangeCheckVersion,
  Scope extends ProjectScope = ProjectScope,
> {
  readonly checkpoint: RunCheckpoint<NoInfer<Version>, Scope>;
  readonly lease: LeaseToken<NoInfer<Scope>>;
  readonly candidateVersion?: Version;
  readonly event?: EventEnvelope<string, unknown, NoInfer<Version>>;
  readonly receipt?: OperationReceipt<NoInfer<Version>>;
  readonly projection?: ProjectionWrite<NoInfer<Version>>;
}

export interface PersistenceAdapter {
  appendEvent(event: EventEnvelope): Promise<void>;
  readEvents(scope: ProjectScope, afterCursor?: string): Promise<readonly EventEnvelope[]>;
  readProjection(scope: ProjectScope): Promise<ProjectProjection | null>;
  readCheckpoint(scope: ProjectScope, runId: RunId): Promise<RunCheckpoint | null>;
  saveCheckpoint<Scope extends ProjectScope>(
    checkpoint: RunCheckpoint<ChangeCheckVersion, Scope>,
    lease: LeaseToken<NoInfer<Scope>>,
  ): Promise<void>;
  saveProjection(projection: ProjectProjection, expectedRevision: number): Promise<void>;
  readReceipt(scope: ProjectScope, operationKey: OperationKey): Promise<OperationReceipt | null>;
  saveReceipt<Scope extends ProjectScope>(
    receipt: OperationReceipt & { readonly scope: Scope },
    lease: LeaseToken<NoInfer<Scope>>,
  ): Promise<void>;
  acquireLease<Scope extends ProjectScope>(scope: Scope, runId: RunId): Promise<LeaseToken<Scope> | null>;
  renewLease<Scope extends ProjectScope>(
    scope: Scope,
    lease: LeaseToken<NoInfer<Scope>>,
  ): Promise<LeaseToken<Scope> | null>;
  commitStep<Version extends ChangeCheckVersion, Scope extends ProjectScope>(
    step: CommitStep<Version, Scope>,
  ): Promise<void>;
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
