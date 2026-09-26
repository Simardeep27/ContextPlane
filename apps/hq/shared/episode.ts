import type { EvidenceRecord } from './evidence.ts';
/** Learning episode derived only from recorded evidence records; missing facts stay null ("Not measured"). */
export type RuleStatus = 'Candidate' | 'Evaluated' | 'Active';
export interface EpisodeStage { id: 'failure' | 'proposed' | 'evaluation' | 'activation' | 'next'; label: string; fact: string | null; eventIds: string[] }
export interface LearningEpisode {
  task: string; activeEpoch: number | null; candidateEpoch: number | null;
  rule: { text: string; reason: string; status: RuleStatus; hash: string; target: string; datasetHash: string } | null;
  evaluation: { correct: number; total: number; unsafeAllowed: number | null; validBlocked: number | null } | null;
  stages: EpisodeStage[];
  metrics: { label: string; value: string | null }[];
}
export const EPISODE_TASK = 'Change Orders amounts from cents to dollars without breaking Billing.';
const finished = (r: EvidenceRecord) => r.phase === 'finished';
const ackTarget = (reasons: string[]) => reasons.find(x => x.startsWith('missing_acknowledgement:'))?.split(':')[1] ?? null;

export function learningEpisode(records: readonly EvidenceRecord[]): LearningEpisode {
  const done = records.filter(finished);
  const policy = (a: string) => done.find(r => r.action === a && r.policy);
  const proposed = policy('policy_proposed'), evaluated = policy('policy_evaluated'), activated = policy('policy_activated');
  const lastPolicy = activated ?? evaluated ?? proposed;
  // Failure = first rejection for a missing acknowledgement before the rule was proposed.
  const proposedAt = proposed ? done.indexOf(proposed) : done.length;
  const failure = done.slice(0, proposedAt).find(r => r.allowed === false && ackTarget(r.reasons));
  const required = failure ? ackTarget(failure.reasons) : null;
  const activeEpoch = proposed?.policy?.epoch ?? done.find(r => r.policyEpoch !== null)?.policyEpoch ?? null;
  const candidateEpoch = activated?.policy?.epoch ?? null;
  const status: RuleStatus = activated?.policy?.passed ? 'Active' : evaluated?.policy?.passed !== null && evaluated ? 'Evaluated' : 'Candidate';
  const target = lastPolicy?.policy?.target ?? '';
  const rule = lastPolicy?.policy && required ? {
    text: `Before ${target || 'the agent'} changes a shared unit, it must hold an acknowledgement from ${required} at the current dependency revision.`,
    reason: `Recorded rejection ${failure!.cursor}: ${failure!.reasons.join(', ')}.`,
    status, hash: lastPolicy.policy.hash, target, datasetHash: lastPolicy.policy.datasetHash } : null;
  const e = (activated ?? evaluated)?.policy;
  const evaluation = e && e.total !== null && e.correct !== null ? { correct: e.correct, total: e.total, unsafeAllowed: e.unsafeAllowed, validBlocked: e.validBlocked } : null;
  const after = activated ? done.slice(done.indexOf(activated) + 1).filter(r => r.policyEpoch === candidateEpoch && r.action !== 'learn') : [];
  const blocked = after.find(r => r.allowed === false), allowed = after.find(r => r.allowed === true && r !== blocked);
  const published = after.find(r => r.publishedHash);
  const next = after.length ? [blocked && `Epoch ${candidateEpoch} blocked the follow-up (${blocked.reasons.join(', ')})`,
    allowed && `allowed it after the acknowledgement (${allowed.cursor})`,
    published ? 'published' : 'completion not yet measured'].filter(Boolean).join('; ') + '.' : null;
  const verified = done.filter(r => r.publishedHash).length;
  const repairs = done.filter(r => r.action === 'diagnose').length;
  const times = records.map(r => Date.parse(r.at)).filter(Number.isFinite);
  const span = times.length > 1 ? `${((Math.max(...times) - Math.min(...times)) / 1000).toFixed(1)} s` : null;
  return {
    task: EPISODE_TASK, activeEpoch, candidateEpoch, rule, evaluation,
    stages: [
      { id: 'failure', label: 'Failure', eventIds: failure ? [failure.eventId] : [],
        fact: failure ? `Change rejected: ${failure.reasons.join(', ')}.` : null },
      { id: 'proposed', label: 'Proposed rule', eventIds: proposed ? [proposed.eventId] : [],
        fact: proposed ? `Rule proposed for ${proposed.policy!.target} at epoch ${proposed.policy!.epoch ?? '?'}.` : null },
      { id: 'evaluation', label: 'Evaluation', eventIds: evaluated ? [evaluated.eventId] : [],
        fact: evaluation ? `${evaluation.correct}/${evaluation.total} cases correct · ${evaluation.unsafeAllowed ?? '?'} unsafe allowed · ${evaluation.validBlocked ?? '?'} valid blocked.` : null },
      { id: 'activation', label: 'Activation', eventIds: activated ? [activated.eventId] : [],
        fact: activated ? `Activated as policy epoch ${candidateEpoch}.` : null },
      { id: 'next', label: 'Next task', eventIds: after.map(r => r.eventId), fact: next },
    ],
    metrics: [
      { label: 'Verified tasks', value: `${verified} published` },
      { label: 'Repair attempts', value: `${repairs} diagnosis` },
      { label: 'Execution time', value: span },
      { label: 'Cost', value: null },
      { label: 'Human interventions', value: null },
    ],
  };
}

/** ILLUSTRATIVE ONLY: the ideal full loop for the "How it works" sample view. Never shown as recorded data. */
export const sampleEpisode: LearningEpisode = {
  task: 'Change Invoices totals from cents to dollars without breaking Payouts.', activeEpoch: 4, candidateEpoch: 5,
  rule: { text: 'Before an Invoices agent changes a shared unit, it must hold an acknowledgement from the Payouts agent at the current dependency revision.',
    reason: 'Invoices change was rejected: Payouts had not acknowledged the new unit.', status: 'Active',
    hash: 'sample', target: 'sample_invoices_agent', datasetHash: 'sample' },
  evaluation: { correct: 12, total: 12, unsafeAllowed: 0, validBlocked: 0 },
  stages: [
    { id: 'failure', label: 'Failure', eventIds: [], fact: 'Invoices change rejected: missing acknowledgement from Payouts.' },
    { id: 'proposed', label: 'Proposed rule', eventIds: [], fact: 'Rule proposed for the Invoices agent at epoch 4.' },
    { id: 'evaluation', label: 'Evaluation', eventIds: [], fact: '12/12 held-out cases correct · 0 unsafe allowed · 0 valid blocked.' },
    { id: 'activation', label: 'Activation', eventIds: [], fact: 'Activated as harness epoch 5.' },
    { id: 'next', label: 'Next task', eventIds: [], fact: 'Next unit change asked Payouts first and shipped on the first attempt.' },
  ],
  metrics: [
    { label: 'Verified tasks', value: '9 → 14 / week' }, { label: 'Repair attempts', value: '3 → 0' },
    { label: 'Execution time', value: '41 → 18 min' }, { label: 'Cost', value: '$6.10 → $2.40' },
    { label: 'Human interventions', value: '2 → 0' },
  ],
};
