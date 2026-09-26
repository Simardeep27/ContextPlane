import { EvidenceCards } from '../evidence/EvidenceCards.tsx';
import type { EvidenceRecord } from '../../shared/evidence.ts';
import type { RuntimeSnapshot } from "../../shared/runtime.ts";
import { clock } from "./format.ts";

interface Props {
  runtime: RuntimeSnapshot;
  onCite: (eventId: string) => void;
}

const short = (hash: string) => (hash.length > 20 ? `${hash.slice(0, 15)}…${hash.slice(-6)}` : hash);


export function RuntimePanel({ runtime, onCite }: Props) {
  const { projection, events } = runtime;
  const records = events.map(e => (e.payload as { evidenceView?: EvidenceRecord } | null)?.evidenceView)
    .filter((r): r is EvidenceRecord => Boolean(r));
  const publications = events.filter((e) => e.type === "dependency.published");

  return (
    <section className="runtime panel">
      <h2>Runtime state</h2>
      <p className="muted small">Read from the Context API. Storage backend and verified completion are not inferred from this connection.</p>

      {!projection ? (
        <p className="muted small">Waiting for the Context API…</p>
      ) : (
        <>
          {projection.dependencies.map((dependency) => {
            return (
              <div key={dependency.dependencyId} className="fact fact--dependency">
                <div className="fact__label">
                  Dependency <code>{dependency.providerServiceId}</code> → <code>{dependency.consumerServiceId}</code>
                </div>
                <div className="revision">
                  <span className="revision__current">
                    Current revision = {dependency.revision}
                  </span>
                </div>
                <div className="small muted mono" title={dependency.artifactHash}>artifact {short(dependency.artifactHash)}</div>
                {dependency.evidenceIds.length > 0 && (
                  <div className="small muted mono">evidence {dependency.evidenceIds.join(", ")}</div>
                )}
              </div>
            );
          })}

          <dl className="facts">
            <div><dt>Policy epoch</dt><dd>{projection.policyEpoch}</dd></div>
            <div><dt>Projection</dt><dd>rev {projection.revision}</dd></div>
            <div><dt>Event cursor</dt><dd className="mono">#{projection.eventCursor}</dd></div>
            <div><dt>Runs</dt><dd>{projection.runs.length}</dd></div>
          </dl>

          {projection.candidateVersion && (
            <div className="fact">
              <div className="fact__label">Proposed code version (not proof of stage, checks or publication)</div>
              <div className="small mono" title={projection.candidateVersion.candidateHash}>
                {short(projection.candidateVersion.candidateHash)} · dep r{projection.candidateVersion.dependencyRevision} · epoch{" "}
                {projection.candidateVersion.policyEpoch}
              </div>
            </div>
          )}

          {publications.length > 0 && (
            <ul className="runtime__events">
              {publications.map((e) => (
                <li key={e.eventId}>
                  <button type="button" className="cite mono" onClick={() => onCite(e.eventId)}>#{e.cursor}</button>
                  <span className="small">
                    {e.actor.id} published r{(e.payload as { dependencyRevision?: number }).dependencyRevision} · {clock(e.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <EvidenceCards records={records} />
          <p className="small muted">Only recorded evidence is shown. A policy epoch alone does not prove improvement.</p>
          {projection.accessRequests.some((request) => request.status === "pending") &&
            <p className="small muted">Pending access requests are read only here; this adapter has no approval controls.</p>}

        </>
      )}
    </section>
  );
}
