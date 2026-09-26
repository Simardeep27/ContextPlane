import { useEffect, useState } from 'react';
import type { EvidenceRecord } from '../../shared/evidence.ts';
import { EvidenceCards } from './EvidenceCards.tsx';
import './evidence.css';
interface Recording { sourceCommit: string; observedAt: string; projectId: string; modelCalls: number; records: EvidenceRecord[] }
export function VerifiedRun() {
  const [data, setData] = useState<Recording | null>(null); const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { const abort = new AbortController();
    fetch('/verification.json', { signal: abort.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort(); }, []);
  const count = step ?? data?.records.length ?? 0; const records = data?.records.slice(0,count) ?? [];
  return <main className="verified-run">
    <header><a href="/">← Live team</a><nav><a href="/index.html">Migration HQ</a></nav><span>RECORDED VERIFICATION</span></header>
    <h1>Follow a change from proposal to proof.</h1>
    <p className="evidence-lead">Actual executor receipts from an isolated verification run. This is a historical replay, not current team work. Controls only navigate recorded events.</p>
    {error && <p role="alert">The verification record could not be loaded. Try refreshing.</p>}
    {!data && !error && <p>Loading recorded evidence…</p>}
    {data && <>
      <div className="record-meta"><span>Observed {new Date(data.observedAt).toLocaleString()}</span>
        <a href={`https://github.com/Simardeep27/ContextPlane/commit/${data.sourceCommit}`}>Source {data.sourceCommit.slice(0,7)}</a>
        <span>{data.modelCalls} model calls · deterministic verification</span></div>
      <div className="replay-controls"><button onClick={() => setStep(0)}>Restart replay</button>
        <button disabled={count === 0} onClick={() => setStep(Math.max(0,count-1))}>Previous event</button>
        <button disabled={count >= data.records.length} onClick={() => setStep(count+1)}>Next recorded event</button>
        <button onClick={() => setStep(null)}>Show complete run</button><span>{count}/{data.records.length} events</span></div>
      <p>Observed dependency revision: <strong>{records.at(-1)?.observedDependencyRevision ?? 'not yet recorded'}</strong> · initial revision {data.records[0]?.observedDependencyRevision}</p>
      <div className="evidence-layout"><section><EvidenceCards records={records} /></section>
        <aside><h2>Recorded timeline</h2><ol className="evidence-timeline">{records.map(r => <li key={r.eventId}>
          <details><summary>#{r.cursor} · {r.action.replaceAll('_',' ')} · {r.phase}</summary>
            <dl><dt>Event</dt><dd>{r.eventId}</dd><dt>Operation</dt><dd>{r.operationKey}</dd><dt>Timestamp</dt><dd>{r.at}</dd>
              {r.candidateHash && <><dt>Code hash</dt><dd>{r.candidateHash}</dd></>}
              {r.dependencyRevision !== null && <><dt>Dependency</dt><dd>r{r.dependencyRevision}</dd></>}
              {r.policyEpoch !== null && <><dt>Policy epoch</dt><dd>{r.policyEpoch}</dd></>}
              {r.passed !== null && <><dt>Checks</dt><dd>{r.passed ? 'Passed' : 'Failed'}</dd></>}
              {r.allowed !== null && <><dt>Decision</dt><dd>{r.allowed ? 'Allowed' : 'Blocked'}</dd></>}
            </dl>{r.reasons.map(reason => <p key={reason}>{reason}</p>)}
            {r.evidenceIds.map(id => <p key={id}><code>{id}</code></p>)}</details></li>)}</ol></aside></div>
    </>}
  </main>;
}
