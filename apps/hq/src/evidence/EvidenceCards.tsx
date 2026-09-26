import './evidence.css';
import { codeEvidence, type EvidenceRecord } from '../../shared/evidence.ts';

export function EvidenceCards({ records }: { records: readonly EvidenceRecord[] }) {
  const policies = records.filter(r => r.policy && r.phase === 'finished' && r.action !== 'learn');
  const blocked = records.filter(r => r.allowed === false);
  return <div className="evidence-cards">
    <h3>Exact code evidence</h3>
    {codeEvidence(records).map((g, i) => <article className="evidence-card" key={`${g.hash}-${i}`}>
      <strong>{g.matches ? 'Staged, passed checks, and published' : 'Incomplete publication evidence'}</strong>
      <code className="evidence-hash">{g.hash}</code>
      <p>Dependency r{g.dependencyRevision ?? 'unknown'} · policy epoch {g.policyEpoch ?? 'unknown'}</p>
      <dl><dt>Staged</dt><dd>{g.staged?.eventId ?? 'Not recorded'}</dd>
        <dt>Checked</dt><dd>{g.tested ? `${g.tested.passed ? 'Passed' : 'Failed'} · ${g.tested.eventId}` : 'Not recorded'}</dd>
        <dt>Published</dt><dd>{g.published?.eventId ?? 'Not recorded'}</dd></dl>
    </article>)}
    {codeEvidence(records).length === 0 && <p>No staged, tested or published revision is recorded.</p>}
    <h3>Coordination blockers</h3>
    {blocked.map(r => <article className="evidence-card" key={r.eventId}><strong>Blocked · dependency r{r.dependencyRevision}</strong>
      <p>{r.reasons.join(' · ') || 'Reason not recorded'}</p><code>{r.eventId}</code></article>)}
    {blocked.length === 0 && <p>No blocked decision in this snapshot.</p>}
    {records.some(r => r.causalChecks.length) && <><h3>Causal verification</h3>{records.flatMap(r => r.causalChecks.map(c =>
      <article className="evidence-card" key={`${r.eventId}-${c.name}`}><strong>{c.name} · {c.passed ? 'Passed' : 'Failed'}</strong>
      <code className="evidence-hash">{c.hash}</code><code>{r.eventId}</code></article>))}</>}
    <h3>Coordination rule lifecycle</h3>
    {policies.map(r => <article className="evidence-card" key={r.eventId}>
      <strong>{r.action === 'policy_proposed' ? 'Proposed rule' : r.action === 'policy_evaluated' ? 'Fixed evaluation' : 'Activated rule'}</strong>
      <p>Target {r.policy!.target} · epoch {r.policy!.epoch ?? 'unchanged'}</p>
      <code className="evidence-hash">{r.policy!.hash}</code>
      <p>Dataset <code>{r.policy!.datasetHash}</code></p>
      {r.policy!.passed !== null && <p>{r.policy!.passed ? 'Passed' : 'Rejected'} · {r.policy!.correct}/{r.policy!.total} correct · unsafe allowed {r.policy!.unsafeAllowed} · valid blocked {r.policy!.validBlocked}</p>}
      <details><summary>Evidence references</summary><code>{r.eventId}</code>
        {r.policy!.proposalEventId && <p>Proposal {r.policy!.proposalEventId}</p>}
        {r.policy!.evaluationEventId && <p>Evaluation {r.policy!.evaluationEventId}</p>}
        {r.evidenceIds.map(id => <p key={id}><code>{id}</code></p>)}</details>
    </article>)}
    {policies.length === 0 && <p>No rule proposal, evaluation or activation is recorded.</p>}
  </div>;
}
