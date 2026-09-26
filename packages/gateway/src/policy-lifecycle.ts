import type { EventId, PolicyCandidate, PolicyHash, ProjectScope } from '@context-plane/contracts';
import { deriveCoordinationRule, evaluateCoordinationRule, type CausalCheck, type CoordinationEvaluation } from '@context-plane/core';
import { canonicalJson, mvp02Scenario, sha256 } from '@context-plane/scenario';
import { requireThat } from './validation.js';

/** Stored in the existing event ledger; no new collection or writable evaluator. */
export interface RuleProposalRecord {
  readonly candidate: PolicyCandidate;
  readonly diagnosisEventId: EventId;
  readonly proposalMode: 'deterministic-rule-derivation';
}
export interface RuleEvaluationRecord {
  readonly proposalEventId: EventId;
  readonly candidateHash: string;
  readonly policyHash: PolicyHash;
  readonly targetAgentId: PolicyCandidate['targetAgentId'];
  readonly evaluation: CoordinationEvaluation;
  readonly evaluatedAt: string;
}
export function proposeCoordinationPolicy(scope: ProjectScope, basePolicyEpoch: number,
  diagnosis: { baseline: CausalCheck; changed: CausalCheck; reverted: CausalCheck },
  diagnosisEventId: EventId, proposedAt: string): RuleProposalRecord {
  const rule = deriveCoordinationRule({ ...diagnosis, changeKind: 'unit_change', observedFailure: 'consumer-contract',
    requiredAgentIds: [mvp02Scenario.developers[1].agentId], changedArtifactPath: 'services/orders/src/quote.ts',
    consumerArtifactPaths: ['services/billing/src/invoice.ts'] });
  requireThat(rule, 'NO_SUPPORTED_LESSON');
  requireThat(Object.values(diagnosis).every(part => canonicalJson(part.stagedCandidate.scope) === canonicalJson(scope)), 'SCOPE_FORBIDDEN');
  return { candidate: { scope, targetAgentId: mvp02Scenario.developers[0].agentId,
    policyHash: sha256(canonicalJson(rule)) as PolicyHash, revision: 1, basePolicyEpoch,
    datasetHash: mvp02Scenario.policyDatasetHash, rule: { ...rule },
    evidence: Object.values(diagnosis).flatMap(part => part.checkResult.evidence), proposedAt },
    diagnosisEventId, proposalMode: 'deterministic-rule-derivation' };
}
export function evaluatePolicyCandidate(proposal: RuleProposalRecord, proposalEventId: EventId, evaluatedAt: string): RuleEvaluationRecord {
  const candidate = proposal.candidate;
  requireThat(candidate.policyHash === sha256(canonicalJson(candidate.rule)), 'POLICY_HASH_MISMATCH');
  requireThat(candidate.datasetHash === mvp02Scenario.policyDatasetHash, 'DATASET_HASH_MISMATCH');
  return { proposalEventId, candidateHash: sha256(canonicalJson(candidate)), policyHash: candidate.policyHash,
    targetAgentId: candidate.targetAgentId, evaluation: evaluateCoordinationRule(candidate.rule, mvp02Scenario.policyCases), evaluatedAt };
}
/** Ordinary checked code. Caller input cannot supply a passing verdict or choose cases. */
export function verifyPolicyActivation(proposal: RuleProposalRecord, record: RuleEvaluationRecord, proposalEventId: EventId): void {
  const expected = evaluatePolicyCandidate(proposal, proposalEventId, record.evaluatedAt);
  requireThat(canonicalJson(record) === canonicalJson(expected), 'EVALUATION_BINDING_MISMATCH');
  requireThat(record.evaluation.passed && record.evaluation.counts.unsafeAllowed === 0 &&
    record.evaluation.counts.validBlocked === 0, 'EVALUATION_REJECTED');
}
