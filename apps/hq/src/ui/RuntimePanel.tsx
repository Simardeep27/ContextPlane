import type { RuntimeSnapshot } from "../../shared/runtime.ts";
import { clock } from "./format.ts";

interface Props {
  runtime: RuntimeSnapshot;
  onCite: (eventId: string) => void;
}

const short = (hash: string) => (hash.length > 20 ? `${hash.slice(0, 15)}…${hash.slice(-6)}` : hash);

// Pieces of the minimum demo that land as the runtime grows; each is listed
// as pending until the stored projection actually reports it.
const pending = [
  { label: "Stale-revision detection & publication authorization", issue: "MVP-04", present: (s: RuntimeSnapshot) => !!s.projection?.candidateVersion },
  { label: "Durable agent runs", issue: "MVP-06", present: (s: RuntimeSnapshot) => (s.projection?.runs.length ?? 0) > 0 },
];

export function RuntimePanel({ runtime, onCite }: Props) {
  const { projection, events } = runtime;
  const publications = events.filter((e) => e.type === "dependency.published");

  return (
    <section className="runtime panel">
      <h2>Runtime state</h2>
      <p className="muted small">Read from MongoDB Atlas through the Context API. Refreshing rebuilds this from stored data.</p>

      {!projection ? (
        <p className="muted small">Waiting for the Context API…</p>
      ) : (
        <>
          {projection.dependencies.map((dependency) => {
            const history = publications
              .map((e) => (e.payload as { dependencyRevision?: number }).dependencyRevision)
              .filter((r): r is number => typeof r === "number");
            const previous = history.length > 0 ? Math.min(...history) - 1 : null;
            return (
              <div key={dependency.dependencyId} className="fact fact--dependency">
                <div className="fact__label">
                  Dependency <code>{dependency.providerServiceId}</code> → <code>{dependency.consumerServiceId}</code>
                </div>
                <div className="revision">
                  {previous !== null && <span className="revision__old">N = {previous}</span>}
                  {previous !== null && <span className="muted">→</span>}
                  <span className="revision__current">
                    {previous !== null ? "N+1 = " : "N = "}
                    {dependency.revision}
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
              <div className="fact__label">Candidate version</div>
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

          <ul className="runtime__pending">
            {pending.filter((p) => !p.present(runtime)).map((p) => (
              <li key={p.issue} className="small muted">
                <span className="pending-dot" /> {p.label} <span className="mono">({p.issue}, not reported yet)</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
