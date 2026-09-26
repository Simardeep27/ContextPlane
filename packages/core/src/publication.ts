import type {
  AgentId, ChangeCheckVersion, CheckResult, ProjectScope, RunId, StagedCandidate,
} from "@context-plane/contracts";
import { canonicalJson, sha256, type PolicyAcknowledgement } from "@context-plane/scenario";

export interface ChangeAcknowledgement extends PolicyAcknowledgement {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly version: ChangeCheckVersion;
}

export interface InspectChangeInput {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly version: ChangeCheckVersion;
  readonly currentDependencyRevision: number;
  readonly currentPolicyEpoch: number;
  readonly requiredAgentIds: readonly AgentId[];
  readonly acknowledgements: readonly ChangeAcknowledgement[];
}

export interface ChangeDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

export function sameScope(left: ProjectScope, right: ProjectScope): boolean {
  return left.orgId === right.orgId && left.projectId === right.projectId;
}

export function sameVersion(left: ChangeCheckVersion, right: ChangeCheckVersion): boolean {
  return left.candidateHash === right.candidateHash
    && left.dependencyRevision === right.dependencyRevision
    && left.policyEpoch === right.policyEpoch;
}

export function inspectChange(input: InspectChangeInput): ChangeDecision {
  const reasons: string[] = [];
  if (input.version.dependencyRevision !== input.currentDependencyRevision) {
    reasons.push("stale_dependency_revision");
  }
  if (input.version.policyEpoch !== input.currentPolicyEpoch) reasons.push("stale_policy_epoch");
  for (const agentId of [...new Set(input.requiredAgentIds)].sort()) {
    const matching = input.acknowledgements.some((ack) => ack.agentId === agentId
      && sameScope(ack.scope, input.scope)
      && ack.runId === input.runId
      && sameVersion(ack.version, input.version)
      && ack.dependencyRevision === input.currentDependencyRevision
      && (ack.outcome === "patched" || ack.outcome === "no-change"));
    if (!matching) reasons.push(`missing_acknowledgement:${agentId}`);
  }
  return { allowed: reasons.length === 0, reasons };
}

export interface AuthorizePublicationInput extends InspectChangeInput {
  readonly stagedCandidate: StagedCandidate;
  readonly checkResult: CheckResult;
  /** Trusted registry supplied by the host. Every named check is required. */
  readonly registeredChecks: readonly string[];
  /** Digest of the stored receipt, not a digest supplied by the proposing agent. */
  readonly expectedCheckResultHash: string;
}

export interface PublicationBinding {
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly version: ChangeCheckVersion;
  readonly stagedCandidateRevision: number;
  readonly checkResultId: CheckResult["checkResultId"];
  readonly checkResultRevision: number;
  readonly checkResultHash: string;
}

export interface PublicationDecision extends ChangeDecision {
  readonly binding?: PublicationBinding;
}

export function hashCheckResult(result: CheckResult): string {
  return sha256(canonicalJson(result));
}

export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

export function checkBindsStaged(result: CheckResult, staged: StagedCandidate): boolean {
  return sameScope(result.scope, staged.scope)
    && result.runId === staged.runId
    && result.stagedCandidateRevision === staged.revision
    && sameVersion(result.version, staged.version);
}

export function authorizePublication(input: AuthorizePublicationInput): PublicationDecision {
  const reasons = [...inspectChange(input).reasons];
  const staged = input.stagedCandidate;
  const check = input.checkResult;
  if (!sameScope(staged.scope, input.scope)) reasons.push("staged_scope_mismatch");
  if (staged.runId !== input.runId) reasons.push("staged_run_mismatch");
  if (!sameVersion(staged.version, input.version)) reasons.push("staged_version_mismatch");
  if (!sameScope(check.scope, input.scope)) reasons.push("check_scope_mismatch");
  if (check.runId !== input.runId) reasons.push("check_run_mismatch");
  if (!sameVersion(check.version, input.version)) reasons.push("check_version_mismatch");
  if (check.stagedCandidateRevision !== staged.revision) reasons.push("staged_revision_mismatch");
  if (!check.passed) reasons.push("registered_checks_failed");
  if (staged.artifactHashes.length === 0) reasons.push("empty_staged_artifacts");
  if (input.registeredChecks.length === 0
    || new Set(input.registeredChecks).size !== input.registeredChecks.length
    || input.registeredChecks.some((name) => name.length === 0)
    || !sameStrings(check.registeredChecks, input.registeredChecks)) {
    reasons.push("registered_checks_mismatch");
  }
  const checkResultHash = hashCheckResult(check);
  if (checkResultHash !== input.expectedCheckResultHash) reasons.push("check_hash_mismatch");
  if (reasons.length > 0) return { allowed: false, reasons };
  return {
    allowed: true,
    reasons: [],
    binding: {
      scope: { ...input.scope },
      runId: input.runId,
      version: { ...input.version },
      stagedCandidateRevision: staged.revision,
      checkResultId: check.checkResultId,
      checkResultRevision: check.revision,
      checkResultHash,
    },
  };
}
