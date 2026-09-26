import type { AgentId, CheckResult, StagedCandidate } from "@context-plane/contracts";
import {
  canonicalJson, mvp02Scenario, sha256,
  type ArtifactFile, type PolicyEvaluationCase,
} from "@context-plane/scenario";
import { checkBindsStaged, sameScope, sameStrings, sameVersion } from "./publication.js";

/** The only learnable behavior. No executable code or permission settings. */
export type CoordinationRule = {
  readonly kind: "unit_change";
  readonly requiredAgentIds: readonly AgentId[];
  readonly requireCurrentDependencyRevision: true;
  readonly requireAcknowledgements: true;
};

/** Actual files executed by the diagnostic runner, including dependencies. */
export interface CausalCheck {
  readonly stagedCandidate: StagedCandidate;
  readonly checkResult: CheckResult;
  readonly artifacts: readonly Pick<ArtifactFile, "path" | "artifactHash">[];
}

export interface DeriveCoordinationRuleInput {
  readonly changeKind: PolicyEvaluationCase["changeKind"];
  readonly observedFailure: PolicyEvaluationCase["observedFailure"];
  readonly requiredAgentIds: readonly AgentId[];
  readonly changedArtifactPath: string;
  readonly consumerArtifactPaths: readonly string[];
  readonly baseline: CausalCheck;
  readonly changed: CausalCheck;
  readonly reverted: CausalCheck;
}

function artifactMap(record: CausalCheck): Map<string, string> | null {
  const entries = record.artifacts.map(({ path, artifactHash }) => [path, artifactHash] as const);
  const map = new Map(entries);
  if (map.size !== entries.length || map.size < 2) return null;
  if (entries.some(([path, hash]) => !path || !hash)) return null;
  // A staged proposal may contain only changed files; the execution includes consumers.
  if (record.stagedCandidate.artifactHashes.length === 0
    || record.stagedCandidate.artifactHashes.some((hash) => ![...map.values()].includes(hash))) return null;
  return map;
}

export function deriveCoordinationRule(input: DeriveCoordinationRuleInput): CoordinationRule | null {
  if (input.changeKind !== "unit_change" || input.observedFailure !== "consumer-contract"
    || input.requiredAgentIds.length === 0 || input.requiredAgentIds.some((id) => !id)
    || input.consumerArtifactPaths.length === 0
    || input.consumerArtifactPaths.includes(input.changedArtifactPath)) return null;

  const { baseline, changed, reverted } = input;
  const records = [baseline, changed, reverted];
  if (!baseline.checkResult.passed || changed.checkResult.passed || !reverted.checkResult.passed) return null;
  if (records.some((record) => !checkBindsStaged(record.checkResult, record.stagedCandidate))) return null;
  if (!sameStrings(baseline.checkResult.registeredChecks, ["consumer-integration"])
    || records.some((record) => !sameStrings(record.checkResult.registeredChecks,
      baseline.checkResult.registeredChecks))) return null;
  if (records.some(({ stagedCandidate: staged }) => !sameScope(staged.scope, baseline.stagedCandidate.scope)
    || staged.runId !== baseline.stagedCandidate.runId
    || staged.version.policyEpoch !== baseline.stagedCandidate.version.policyEpoch)) return null;
  if (!sameVersion(baseline.stagedCandidate.version, reverted.stagedCandidate.version)
    || changed.stagedCandidate.version.dependencyRevision > baseline.stagedCandidate.version.dependencyRevision
    || changed.stagedCandidate.version.candidateHash === baseline.stagedCandidate.version.candidateHash) return null;

  const before = artifactMap(baseline);
  const after = artifactMap(changed);
  const restored = artifactMap(reverted);
  if (!before || !after || !restored || !sameStrings([...before.keys()], [...after.keys()])
    || !sameStrings([...before.keys()], [...restored.keys()])) return null;
  if ([...before].some(([path, hash]) => restored.get(path) !== hash)) return null;
  const differences = [...before].filter(([path, hash]) => after.get(path) !== hash);
  if (differences.length !== 1 || differences[0]?.[0] !== input.changedArtifactPath) return null;
  if (input.consumerArtifactPaths.some((path) => !before.has(path) || before.get(path) !== after.get(path))) return null;

  return Object.freeze({
    kind: "unit_change",
    requiredAgentIds: Object.freeze([...new Set(input.requiredAgentIds)].sort()),
    requireCurrentDependencyRevision: true,
    requireAcknowledgements: true,
  });
}

function isCoordinationRule(value: unknown): value is CoordinationRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Readonly<Record<string, unknown>>;
  if (!sameStrings(Object.keys(rule), ["kind", "requiredAgentIds", "requireCurrentDependencyRevision", "requireAcknowledgements"])) return false;
  return rule.kind === "unit_change"
    && rule.requireCurrentDependencyRevision === true
    && rule.requireAcknowledgements === true
    && Array.isArray(rule.requiredAgentIds)
    && rule.requiredAgentIds.length > 0
    && rule.requiredAgentIds.every((id: unknown) => typeof id === "string" && id.length > 0)
    && new Set(rule.requiredAgentIds).size === rule.requiredAgentIds.length;
}

/** Labels are deliberately absent from the decision function's input. */
export type CoordinationCase = Omit<PolicyEvaluationCase, "expectedDecision" | "eligibleForLearning">;

export interface CoordinationDecision {
  readonly decision: "allow" | "block" | "ignore";
  readonly reasons: readonly string[];
}

export function applyCoordinationRule(rule: unknown, input: CoordinationCase): CoordinationDecision {
  if (!isCoordinationRule(rule)) return { decision: "block", reasons: ["invalid_coordination_rule"] };
  // An unrelated failed test provides no monetary-unit coordination lesson.
  if (input.changeKind === "unrelated_failure") return { decision: "ignore", reasons: ["unrelated_failure"] };
  if (input.changeKind !== "unit_change") return { decision: "allow", reasons: [] };
  const reasons: string[] = [];
  if (input.candidateDependencyRevision !== input.dependencyRevision) reasons.push("stale_dependency_revision");
  const required = [...new Set([...rule.requiredAgentIds, ...input.requiredAgentIds])].sort();
  for (const agentId of required) {
    if (!input.acknowledgements.some((ack) => ack.agentId === agentId
      && ack.dependencyRevision === input.dependencyRevision
      && (ack.outcome === "patched" || ack.outcome === "no-change"))) {
      reasons.push(`missing_acknowledgement:${agentId}`);
    }
  }
  return { decision: reasons.length > 0 ? "block" : "allow", reasons };
}

export interface CoordinationEvaluation {
  readonly decisions: readonly (CoordinationDecision & {
    readonly caseId: string;
    readonly expectedDecision: PolicyEvaluationCase["expectedDecision"];
    readonly matched: boolean;
  })[];
  readonly counts: {
    readonly total: number;
    readonly correct: number;
    readonly incorrect: number;
    readonly blocked: number;
    readonly allowed: number;
    readonly ignored: number;
    readonly unsafeAllowed: number;
    readonly validBlocked: number;
  };
  readonly passed: boolean;
  readonly datasetHash: string;
  readonly reasons: readonly string[];
}

// This evaluator accepts only the dataset registered by the scenario package.
const registeredDatasetHash = mvp02Scenario.policyDatasetHash;

export function evaluateCoordinationRule(
  rule: unknown,
  cases: readonly PolicyEvaluationCase[],
): CoordinationEvaluation {
  const datasetHash = sha256(canonicalJson(cases));
  const reasons: string[] = [];
  if (datasetHash !== registeredDatasetHash) reasons.push("unregistered_evaluation_dataset");
  if (!isCoordinationRule(rule)) reasons.push("invalid_coordination_rule");
  const decisions = cases.map((entry) => {
    // Explicit projection prevents accidental use of labels by the policy.
    const decision = applyCoordinationRule(rule, {
      caseId: entry.caseId,
      changeKind: entry.changeKind,
      dependencyRevision: entry.dependencyRevision,
      candidateDependencyRevision: entry.candidateDependencyRevision,
      requiredAgentIds: entry.requiredAgentIds,
      acknowledgements: entry.acknowledgements,
      observedFailure: entry.observedFailure,
    });
    return { ...decision, caseId: entry.caseId, expectedDecision: entry.expectedDecision,
      matched: decision.decision === entry.expectedDecision };
  });
  const count = (predicate: (entry: (typeof decisions)[number]) => boolean) => decisions.filter(predicate).length;
  const correct = count((entry) => entry.matched);
  const counts = {
    total: decisions.length,
    correct,
    incorrect: decisions.length - correct,
    blocked: count((entry) => entry.decision === "block"),
    allowed: count((entry) => entry.decision === "allow"),
    ignored: count((entry) => entry.decision === "ignore"),
    unsafeAllowed: count((entry) => entry.expectedDecision === "block" && entry.decision !== "block"),
    validBlocked: count((entry) => entry.expectedDecision !== "block" && entry.decision === "block"),
  };
  if (counts.incorrect > 0) reasons.push("evaluation_decision_mismatch");
  return { decisions, counts, passed: reasons.length === 0 && cases.length > 0, datasetHash, reasons };
}
