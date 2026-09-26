import { useEffect, useMemo, useState } from 'react';
import type { EvidenceRecord } from '../../shared/evidence.ts';
import { learningEpisode, sampleEpisode, type LearningEpisode } from '../../shared/episode.ts';
import { groupByPerson, type AgentView } from '../../shared/harness.ts';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; records: EvidenceRecord[]; observedAt: string; sourceCommit: string };
export function LearningEpisodePanel() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => { const abort = new AbortController();
    fetch('/verification.json', { signal: abort.signal }).then(r => { if (!r.ok) throw Error(); return r.json(); })
      .then(d => setLoad({ state: 'ready', records: d.records, observedAt: d.observedAt, sourceCommit: d.sourceCommit }))
      .catch(() => { if (!abort.signal.aborted) setLoad({ state: 'error' }); });
    return () => abort.abort(); }, []);
  const ep = useMemo(() => load.state === 'ready' ? learningEpisode(load.records) : null, [load]);
  return <section className="episode" aria-labelledby="episode-title">
    <header className="episode-head"><h2 id="episode-title">Learning episode</h2><span className="replay-badge">Recorded replay</span></header>
    {load.state === 'loading' && <p className="episode-muted">Loading recorded evidence…</p>}
    {load.state === 'error' && <p className="episode-muted">Recorded evidence is unavailable.</p>}
    {ep && load.state === 'ready' && <EpisodeBody ep={ep} evidence={{sourceCommit: load.sourceCommit, observedAt: load.observedAt}}/>}
  </section>;
}

export function CompanyTree({ views, order, label, company }: { views: AgentView[]; order: readonly string[]; label: (p: string) => string; company: string }) {
  const groups = groupByPerson(views, order);
  return <section className="company-tree" aria-label="Company tree">
    <div className="tree-root">{company}</div>
    <ul>{groups.map(({ person, agents }) => <li key={person}><span className="tree-person">{label(person)}</span>
      {agents.length ? <ul>{agents.map(a => <li key={a.identity} title={a.identity}>
        <span className={`dot dot-${a.status}`} aria-label={a.status}/><code>{a.suffix}</code><span className="tree-task">{a.task ?? '—'}</span></li>)}</ul>
        : <span className="tree-task"> no agents reporting</span>}</li>)}</ul>
  </section>;
}

function EpisodeBody({ ep, evidence }: { ep: LearningEpisode; evidence?: { sourceCommit: string; observedAt: string } }) {
  return <>
      <p className="episode-task"><span>Task</span>{ep.task}</p>
      <ol className="version-strip" aria-label="Versions">
        <li>Model <strong>unchanged</strong></li>
        <li>Active harness <strong>v{ep.activeEpoch ?? '?'}</strong></li>
        <li aria-hidden="true">→</li>
        <li>Candidate <strong>{ep.candidateEpoch === null ? 'none recorded' : `v${ep.candidateEpoch}`}</strong></li>
      </ol>
      <ol className="stepper">{ep.stages.map((s, i) => <li key={s.id} className={s.fact ? 'done' : 'unmeasured'}>
        <span className="step-n">{i + 1}</span><strong>{s.label}</strong><p>{s.fact ?? 'Not yet measured'}</p></li>)}</ol>
      {ep.rule && <article className="rule-card">
        <header><span>Proposed coordination rule</span><em className={`rule-status ${ep.rule.status.toLowerCase()}`}>{ep.rule.status}</em></header>
        <p className="rule-text">{ep.rule.text}</p><p className="rule-reason"><span>Reason</span>{ep.rule.reason}</p>
        {ep.evaluation && <p className="rule-reason"><span>Evaluation</span>{ep.evaluation.correct}/{ep.evaluation.total} held-out cases</p>}
        {evidence && <small>Rule wording is rendered from the recorded target, rejection reason, and policy lifecycle; the record stores its hash, not prose.</small>}
      </article>}
      <dl className="episode-metrics">{ep.metrics.map(m => <div key={m.label}><dt>{m.label}</dt><dd className={m.value ? '' : 'nm'}>{m.value ?? 'Not measured'}</dd></div>)}</dl>
      {evidence && <details className="episode-evidence"><summary>View evidence</summary><dl>
        <div><dt>Source commit</dt><dd><code>{evidence.sourceCommit}</code></dd></div>
        <div><dt>Observed</dt><dd>{evidence.observedAt}</dd></div>
        {ep.rule && <><div><dt>Policy hash</dt><dd><code>{ep.rule.hash}</code></dd></div><div><dt>Dataset hash</dt><dd><code>{ep.rule.datasetHash}</code></dd></div></>}
        {ep.stages.map(s => <div key={s.id}><dt>{s.label}</dt><dd>{s.eventIds.length ? s.eventIds.map(id => <code key={id}>{id}</code>) : '—'}</dd></div>)}
      </dl></details>}
  </>;
}
export function SampleEpisodePanel() {
  return <section className="episode sample" aria-labelledby="sample-episode-title">
    <header className="episode-head"><h2 id="sample-episode-title">Learning episode · the ideal loop</h2><span className="replay-badge sample-badge">Sample · illustrative</span></header>
    <EpisodeBody ep={sampleEpisode}/>
  </section>;
}
