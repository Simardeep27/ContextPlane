/** Presentation-only allowlist. Raw event payloads and executor output never cross it. */
export interface EvidenceRecord {
  eventId: string; cursor: string; at: string; action: string; phase: string; operationKey: string;
  dependencyRevision: number | null; policyEpoch: number | null; candidateHash: string | null;
  stagedHash: string | null; testedHash: string | null; publishedHash: string | null;
  observedDependencyRevision: number | null; causalChecks: { name: string; hash: string; passed: boolean | null }[];
  passed: boolean | null; allowed: boolean | null; reasons: string[]; evidenceIds: string[];
  policy: { phase: string; hash: string; target: string; epoch: number | null; datasetHash: string;
    proposalEventId: string | null; evaluationEventId: string | null; passed: boolean | null;
    total: number | null; correct: number | null; unsafeAllowed: number | null; validBlocked: number | null } | null;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown): string | null => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(v) ? v : null;
const integer = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const ids = (v: unknown): string[] => Array.isArray(v) ? v.map(id).filter((s): s is string => s !== null).slice(0,100) : [];
const actions = new Set(['propose_change','check_change','stage_change','run_checks','apply_change','acknowledge_change',
  'send_agent_message','diagnose','policy_proposed','policy_evaluated','policy_activated','learn','report_progress']);

export function evidenceRecord(input: unknown): EvidenceRecord | null {
  const event = object(input); const payload = object(event.payload); const result = object(payload.result);
  const action = id(payload.tool); const phase = payload.phase;
  if (!action || !actions.has(action) || !['started','finished'].includes(String(phase)) ||
      event.type !== `harness.${action}.${phase}` || !id(event.eventId) || !id(event.cursor)) return null;
  const stage = object(result.stagedCandidate); const check = object(result.checkResult); const proof = object(result.proof);
  const version = object(event.candidateVersion ?? stage.version ?? check.version);
  const decision = object(result.authorization); const proposed = object(result.record);
  const candidate = object(proposed.candidate ?? result.policy);
  const evaluation = object(proposed.evaluation ?? result.evaluation); const counts = object(evaluation.counts);
  const isPolicy = ['policy_proposed','policy_evaluated','policy_activated','learn'].includes(action);
  const timestamp = typeof event.occurredAt === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(event.occurredAt) ? event.occurredAt : '';
  return {
    eventId: id(event.eventId)!, cursor: id(event.cursor)!, at: timestamp, action, phase: String(phase),
    operationKey: id(payload.operationKey) ?? '', dependencyRevision: integer(version.dependencyRevision),
    policyEpoch: integer(version.policyEpoch), candidateHash: id(version.candidateHash),
    stagedHash: action === 'stage_change' ? id(object(stage.version).candidateHash) : null,
    testedHash: action === 'run_checks' ? id(object(check.version).candidateHash) : null,
    publishedHash: action === 'apply_change' && proof.published === true ? id(proof.candidateHash) : null,
    observedDependencyRevision: integer(object(payload.state).dependencyRevision),
    causalChecks: action === 'diagnose' ? ['baseline','changed','reverted'].flatMap(name => {
      const part = object(object(result.diagnosis)[name]); const hash = id(object(object(part.stagedCandidate).version).candidateHash);
      return hash ? [{ name, hash, passed: bool(object(part.checkResult).passed) }] : [];
    }) : [],
    passed: bool(check.passed ?? evaluation.passed), allowed: bool(result.allowed ?? decision.allowed),
    reasons: ids(result.reasons ?? decision.reasons), evidenceIds: ids(result.evidenceIds),
    policy: isPolicy ? { phase: action, hash: id(candidate.policyHash ?? proposed.policyHash) ?? '',
      target: id(candidate.targetAgentId ?? proposed.targetAgentId) ?? '', epoch: integer(candidate.policyEpoch ?? candidate.basePolicyEpoch),
      datasetHash: id(candidate.datasetHash ?? evaluation.datasetHash) ?? '',
      proposalEventId: id(proposed.proposalEventId ?? result.proposalEventId), evaluationEventId: id(result.evaluationEventId),
      passed: bool(evaluation.passed), total: integer(counts.total), correct: integer(counts.correct),
      unsafeAllowed: integer(counts.unsafeAllowed), validBlocked: integer(counts.validBlocked) } : null,
  };
}

export function codeEvidence(records: readonly EvidenceRecord[]) {
  const groups = new Map<string, { hash: string; dependencyRevision: number | null; policyEpoch: number | null;
    staged: EvidenceRecord | null; tested: EvidenceRecord | null; published: EvidenceRecord | null }>();
  for (const record of records) {
    if (!record.candidateHash || record.phase !== 'finished') continue;
    // Equal hashes under different dependency revisions/epochs are different checks.
    const key = JSON.stringify([record.candidateHash, record.dependencyRevision, record.policyEpoch]);
    const group = groups.get(key) ?? { hash: record.candidateHash, dependencyRevision: record.dependencyRevision,
      policyEpoch: record.policyEpoch, staged: null, tested: null, published: null };
    if (record.stagedHash === group.hash) group.staged = record;
    if (record.testedHash === group.hash) group.tested = record;
    if (record.publishedHash === group.hash) group.published = record;
    groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, matches: Boolean(g.staged && g.tested?.passed && g.published) }));
}
