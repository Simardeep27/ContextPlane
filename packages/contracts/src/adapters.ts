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

export interface LeaseToken {
  readonly runId: RunId;
  readonly generation: number;
  readonly expiresAt: string;
}

export interface PersistenceAdapter {
  appendEvent(event: EventEnvelope): Promise<void>;
  readEvents(scope: ProjectScope, afterCursor?: string): Promise<readonly EventEnvelope[]>;
  readProjection(scope: ProjectScope): Promise<ProjectProjection | null>;
  saveCheckpoint(checkpoint: RunCheckpoint, lease: LeaseToken): Promise<void>;
  readReceipt(scope: ProjectScope, operationKey: OperationKey): Promise<OperationReceipt | null>;
  saveReceipt(receipt: OperationReceipt, lease: LeaseToken): Promise<void>;
  acquireLease(scope: ProjectScope, runId: RunId): Promise<LeaseToken | null>;
  renewLease(scope: ProjectScope, lease: LeaseToken): Promise<LeaseToken | null>;
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
