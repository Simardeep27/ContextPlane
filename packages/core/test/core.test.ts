import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentId, ChangeCheckVersion, CheckResult, CheckResultId, OperationKey,
  ProjectId, RunId, StagedCandidate,
} from "@context-plane/contracts";
import { candidateHash, mvp02Scenario, type ArtifactFile, type PolicyEvaluationCase } from "@context-plane/scenario";
import {
  applyCoordinationRule, authorizePublication, deriveCoordinationRule,
  evaluateCoordinationRule, hashCheckResult, inspectChange,
  type AuthorizePublicationInput, type CausalCheck, type CoordinationRule,
  type DeriveCoordinationRuleInput, type InspectChangeInput,
} from "../src/index.js";

const scope = mvp02Scenario.scope;
const runId = "run_core_test" as RunId;
const consumer = mvp02Scenario.developers[1].agentId;
const version: ChangeCheckVersion = {
  candidateHash: mvp02Scenario.combinedCandidate.candidateHash,
  dependencyRevision: 8,
  policyEpoch: 1,
};
const at = "2026-09-26T16:00:00.000Z";

function inspectInput(): InspectChangeInput {
  return {
    scope, runId, version,
    currentDependencyRevision: 8,
    currentPolicyEpoch: 1,
    requiredAgentIds: [consumer],
    acknowledgements: [{ agentId: consumer, scope, runId, version,
      dependencyRevision: 8, outcome: "patched" }],
  };
}

function stage(artifacts: readonly ArtifactFile[], stagedVersion = version, revision = 1): StagedCandidate {
  return {
    scope, runId, revision, version: stagedVersion,
    operationKey: `operation_${revision}` as OperationKey,
    artifactHashes: artifacts.map((entry) => entry.artifactHash),
    evidence: [], stagedAt: at,
  };
}

function check(staged: StagedCandidate, passed = true): CheckResult {
  return {
    scope: staged.scope, runId: staged.runId, version: staged.version,
    checkResultId: `check_${staged.revision}` as CheckResultId,
    revision: staged.revision + 1,
    stagedCandidateRevision: staged.revision,
    registeredChecks: ["consumer-integration"], passed, evidence: [], completedAt: at,
  };
}

function publicationInput(): AuthorizePublicationInput {
  const stagedCandidate = stage(mvp02Scenario.combinedCandidate.artifacts);
  const checkResult = check(stagedCandidate);
  return { ...inspectInput(), stagedCandidate, checkResult,
    registeredChecks: ["consumer-integration"], expectedCheckResultHash: hashCheckResult(checkResult) };
}

function causalInput(): DeriveCoordinationRuleInput {
  const before = mvp02Scenario.snapshots["dev-b-published"];
  const baselineVersion = { ...version, candidateHash: candidateHash(before) };
  const record = (artifacts: readonly ArtifactFile[], recordVersion: ChangeCheckVersion,
    revision: number, passed: boolean): CausalCheck => {
    const stagedCandidate = stage(artifacts, recordVersion, revision);
    return { stagedCandidate, checkResult: check(stagedCandidate, passed), artifacts };
  };
  return {
    changeKind: "unit_change", observedFailure: "consumer-contract", requiredAgentIds: [consumer],
    changedArtifactPath: "services/orders/src/quote.ts",
    consumerArtifactPaths: ["services/billing/src/invoice.ts"],
    baseline: record(before, baselineVersion, 1, true),
    // Preserve the stale proposal's declared revision; this is diagnostic execution.
    changed: record(mvp02Scenario.snapshots["stale-candidate"], {
      candidateHash: mvp02Scenario.staleCandidate.candidateHash,
      dependencyRevision: 7, policyEpoch: 1,
    }, 3, false),
    reverted: record(before, baselineVersion, 5, true),
  };
}

function learnedRule(): CoordinationRule {
  const rule = deriveCoordinationRule(causalInput());
  assert.ok(rule);
  return rule;
}

test("change inspection rejects stale dependency or policy and requires exact scoped acknowledgements", () => {
  const input = inspectInput();
  assert.equal(inspectChange(input).allowed, true);
  assert.deepEqual(inspectChange({ ...input, currentDependencyRevision: 9 }).reasons,
    ["stale_dependency_revision", `missing_acknowledgement:${consumer}`]);
  assert.equal(inspectChange({ ...input, currentPolicyEpoch: 2 }).allowed, false);
  const ack = input.acknowledgements[0]!;
  const wrong = [
    { ...ack, scope: { ...scope, projectId: "other" as ProjectId } },
    { ...ack, runId: "other" as RunId },
    { ...ack, version: { ...version, candidateHash: mvp02Scenario.staleCandidate.candidateHash } },
    { ...ack, version: { ...version, policyEpoch: 0 } },
    { ...ack, version: { ...version, dependencyRevision: 7 } },
    { ...ack, dependencyRevision: 7 },
  ];
  for (const invalid of wrong) {
    assert.deepEqual(inspectChange({ ...input, acknowledgements: [invalid] }),
      { allowed: false, reasons: [`missing_acknowledgement:${consumer}`] });
  }
});

test("publication binds the exact staged revision, receipt digest, scope, run and version", () => {
  const input = publicationInput();
  const result = authorizePublication(input);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.binding, {
    scope, runId, version, stagedCandidateRevision: 1,
    checkResultId: input.checkResult.checkResultId,
    checkResultRevision: input.checkResult.revision,
    checkResultHash: input.expectedCheckResultHash,
  });
  const changes: readonly Partial<CheckResult>[] = [
    { scope: { ...scope, projectId: "other" as ProjectId } },
    { runId: "other" as RunId },
    { stagedCandidateRevision: 99 },
    { version: { ...version, policyEpoch: 0 } },
    { version: { ...version, dependencyRevision: 7 } },
    { version: { ...version, candidateHash: mvp02Scenario.staleCandidate.candidateHash } },
    { passed: false }, { registeredChecks: [] }, { registeredChecks: ["unregistered-check"] },
  ];
  for (const change of changes) {
    const checkResult = { ...input.checkResult, ...change };
    const decision = authorizePublication({ ...input, checkResult, expectedCheckResultHash: hashCheckResult(checkResult) });
    assert.equal(decision.allowed, false, JSON.stringify(change));
    assert.equal(decision.binding, undefined);
  }
  assert.equal(authorizePublication({ ...input, expectedCheckResultHash: "tampered" }).allowed, false);
  assert.equal(authorizePublication({ ...input, registeredChecks: [] }).allowed, false);
  assert.equal(authorizePublication({ ...input, currentPolicyEpoch: 2 }).allowed, false);
  assert.equal(authorizePublication({ ...input, stagedCandidate: { ...input.stagedCandidate,
    version: { ...version, policyEpoch: 0 } } }).allowed, false);
  assert.equal(authorizePublication({ ...input, stagedCandidate: { ...input.stagedCandidate,
    artifactHashes: [] } }).allowed, false);
});

test("causal derivation preserves stale provenance while isolating the provider change", () => {
  const input = causalInput();
  assert.equal(input.changed.stagedCandidate.version.dependencyRevision, 7);
  assert.equal(input.baseline.stagedCandidate.version.dependencyRevision, 8);
  assert.deepEqual(deriveCoordinationRule(input), {
    kind: "unit_change", requiredAgentIds: [consumer],
    requireCurrentDependencyRevision: true, requireAcknowledgements: true,
  });
  // Diagnostic failure is still not publishable at current revision 8.
  assert.equal(authorizePublication({ ...publicationInput(), version: input.changed.stagedCandidate.version,
    stagedCandidate: input.changed.stagedCandidate, checkResult: input.changed.checkResult,
    expectedCheckResultHash: hashCheckResult(input.changed.checkResult) }).allowed, false);
});

test("unrelated failures, missing controls, changed consumers and mismatched checks yield no lesson", () => {
  const input = causalInput();
  assert.equal(deriveCoordinationRule({ ...input, observedFailure: "unrelated-test" }), null);
  assert.equal(deriveCoordinationRule({ ...input, changeKind: "unrelated_failure" }), null);
  assert.equal(deriveCoordinationRule({ ...input, baseline: { ...input.baseline,
    checkResult: { ...input.baseline.checkResult, passed: false } } }), null);
  assert.equal(deriveCoordinationRule({ ...input, changed: { ...input.changed,
    checkResult: { ...input.changed.checkResult, passed: true } } }), null);
  assert.equal(deriveCoordinationRule({ ...input, changed: { ...input.changed,
    checkResult: { ...input.changed.checkResult, stagedCandidateRevision: 100 } } }), null);
  assert.equal(deriveCoordinationRule({ ...input, changed: { ...input.changed,
    checkResult: { ...input.changed.checkResult, registeredChecks: ["unrelated-test"] } } }), null);
  assert.equal(deriveCoordinationRule({ ...input, changed: { ...input.changed,
    artifacts: mvp02Scenario.snapshots["combined-candidate"] } }), null);
  assert.equal(deriveCoordinationRule({ ...input, reverted: { ...input.reverted,
    artifacts: mvp02Scenario.snapshots.baseline } }), null);
  assert.equal(deriveCoordinationRule({ ...input, consumerArtifactPaths: [] }), null);
});

test("frozen dataset accepts bounded rule and rejects overblocking or weakened rules", () => {
  const rule = learnedRule();
  const result = evaluateCoordinationRule(rule, mvp02Scenario.policyCases);
  assert.equal(result.passed, true);
  assert.equal(result.datasetHash, mvp02Scenario.policyDatasetHash);
  assert.deepEqual(result.counts, { total: 5, correct: 5, incorrect: 0, blocked: 2,
    allowed: 2, ignored: 1, unsafeAllowed: 0, validBlocked: 0 });
  const overblocking = evaluateCoordinationRule({ ...rule,
    requiredAgentIds: [consumer, "unnecessary-agent" as AgentId] }, mvp02Scenario.policyCases);
  assert.equal(overblocking.passed, false);
  assert.equal(overblocking.counts.validBlocked, 1);
  for (const harmful of [
    { ...rule, kind: "all_changes" }, { ...rule, requireAcknowledgements: false },
    { ...rule, permissions: ["publish"] }, { ...rule, requiredAgentIds: [] },
    { ...rule, expectedDecision: "allow" },
  ]) assert.equal(evaluateCoordinationRule(harmful, mvp02Scenario.policyCases).passed, false);
});

test("decision logic cannot read labels; modified or empty evaluation datasets cannot pass", () => {
  const rule = learnedRule();
  const original = evaluateCoordinationRule(rule, mvp02Scenario.policyCases);
  const relabelled: PolicyEvaluationCase[] = mvp02Scenario.policyCases.map((entry) => ({
    ...entry, expectedDecision: "allow", eligibleForLearning: !entry.eligibleForLearning,
  }));
  const modified = evaluateCoordinationRule(rule, relabelled);
  assert.deepEqual(modified.decisions.map((entry) => entry.decision), original.decisions.map((entry) => entry.decision));
  assert.equal(modified.passed, false);
  assert.ok(modified.reasons.includes("unregistered_evaluation_dataset"));
  assert.equal(evaluateCoordinationRule(rule, []).passed, false);
});

test("held-out revision requires a fresh acknowledgement and permits coordinated work", () => {
  const rule = learnedRule();
  const unseenConsumer = "agent_held_out_consumer" as AgentId;
  const heldOut = {
    caseId: "held-out-new-unit-change-revision-12", changeKind: "unit_change" as const,
    dependencyRevision: 12, candidateDependencyRevision: 12,
    requiredAgentIds: [consumer], observedFailure: null,
    acknowledgements: [{ agentId: consumer, dependencyRevision: 8, outcome: "patched" as const }],
  };
  assert.equal(applyCoordinationRule(rule, heldOut).decision, "block");
  assert.equal(applyCoordinationRule(rule, { ...heldOut,
    acknowledgements: [{ agentId: consumer, dependencyRevision: 12, outcome: "no-change" }] }).decision, "allow");
  const newDependencyConsumer = { ...heldOut, requiredAgentIds: [consumer, unseenConsumer],
    acknowledgements: [{ agentId: consumer, dependencyRevision: 12, outcome: "patched" as const }] };
  assert.deepEqual(applyCoordinationRule(rule, newDependencyConsumer), {
    decision: "block", reasons: [`missing_acknowledgement:${unseenConsumer}`],
  });
  assert.equal(applyCoordinationRule(rule, { ...newDependencyConsumer,
    acknowledgements: [...newDependencyConsumer.acknowledgements,
      { agentId: unseenConsumer, dependencyRevision: 12, outcome: "no-change" }] }).decision, "allow");
  assert.equal(applyCoordinationRule(rule, { ...heldOut,
    changeKind: "field_addition", acknowledgements: [] }).decision, "allow");
  assert.equal(applyCoordinationRule(rule, { ...heldOut,
    changeKind: "unrelated_failure", observedFailure: "unrelated-test" }).decision, "ignore");
});

test("an equivalent predefined guard matches the learned rule; no unique learning advantage is claimed", () => {
  const staticGuard: CoordinationRule = {
    kind: "unit_change", requiredAgentIds: [consumer],
    requireCurrentDependencyRevision: true, requireAcknowledgements: true,
  };
  assert.deepEqual(evaluateCoordinationRule(staticGuard, mvp02Scenario.policyCases),
    evaluateCoordinationRule(learnedRule(), mvp02Scenario.policyCases));
});
