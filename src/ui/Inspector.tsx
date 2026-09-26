import type { CSSProperties, ReactNode } from "react";

import { agentProfiles } from "../../shared/events.ts";
import { stateLabels, type AgentView, type Traced } from "../../shared/projection.ts";
import { stateColors } from "../scene/layout.ts";
import { clock, relative, useNow } from "./format.ts";

interface Props {
  agent: AgentView;
  onClose: () => void;
  onCite: (eventId: string) => void;
  onShowTrail: () => void;
}

const evidenceIcons = { tool: "⚙", test: "✔", message: "✉", approval: "🔑", result: "★" } as const;

export function Inspector({ agent, onClose, onCite, onShowTrail }: Props) {
  const now = useNow();
  const profile = agentProfiles[agent.key];
  const color = stateColors[agent.state];

  const field = (label: string, traced: Traced<unknown> | null, children: ReactNode) => (
    <div className="field">
      <div className="field__label">
        {label}
        {traced && (
          <button type="button" className="cite mono" onClick={() => onCite(traced.eventId)} title="Show source event">
            {traced.eventId}
          </button>
        )}
      </div>
      <div className="field__value">{children}</div>
    </div>
  );

  return (
    <aside className="inspector panel" style={{ "--agent": profile.color, "--state": color } as CSSProperties}>
      <header className="inspector__head">
        <div>
          <h2>{profile.name}</h2>
          <p className="muted">{profile.employee} · {profile.team} team</p>
        </div>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close inspector">×</button>
      </header>

      <div className="inspector__state">
        <span className="state-chip">{stateLabels[agent.state]}</span>
        {agent.stateSince && <span className="muted">since {clock(agent.stateSince.at)}</span>}
      </div>

      {field("Current objective", agent.objective, (
  <>
        {agent.objective?.value ?? <span className="muted">No active run</span>}
  </>
))}
      {field("Latest action", agent.latestAction, (
  <>
        {agent.latestAction ? (
          <>
            {agent.latestAction.value}
            <span className="muted"> · {relative(agent.latestAction.at, now)}</span>
          </>
        ) : (
          <span className="muted">Nothing yet</span>
        )}
  </>
))}
      {field("Blocker", agent.blocker, (
  <>
        {agent.blocker ? <span className="blocker">{agent.blocker.value}</span> : <span className="muted">None</span>}
  </>
))}
      {field("Estimated completion", agent.eta, (
  <>
        {agent.state === "complete" ? (
          <span className="muted">Done</span>
        ) : agent.eta ? (
          <>
            {clock(agent.eta.value)} <span className="muted">({relative(agent.eta.value, now)})</span>
          </>
        ) : (
          <span className="muted">Unknown</span>
        )}
  </>
))}

      <h3>Evidence <span className="count">{agent.evidence.length}</span></h3>
      {agent.evidence.length === 0 ? (
        <p className="muted small">No evidence recorded yet.</p>
      ) : (
        <ul className="evidence">
          {[...agent.evidence].reverse().map((item) => (
            <li key={`${item.eventId}:${item.id}`}>
              <span className={`evidence__icon evidence__icon--${item.kind}`}>{evidenceIcons[item.kind]}</span>
              <div>
                <p>{item.label}</p>
                <p className="small muted">
                  <span className="mono">{item.id}</span> · {clock(item.at)} ·{" "}
                  <button type="button" className="link small" onClick={() => onCite(item.eventId)}>event</button>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Messages <span className="count">{agent.messages.length}</span></h3>
      {agent.messages.length === 0 ? (
        <p className="muted small">No messages exchanged yet.</p>
      ) : (
        <ul className="messages">
          {[...agent.messages].reverse().map((m) => {
            const outgoing = m.from === agent.key;
            const other = agentProfiles[outgoing ? m.to : m.from];
            return (
              <li key={m.eventId} className={outgoing ? "is-out" : "is-in"}>
                <p className="small muted">
                  {outgoing ? `To ${other.name}` : `From ${other.name}`} · {clock(m.at)}
                </p>
                <button type="button" className="bubble" onClick={() => onCite(m.eventId)}>{m.body}</button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="btn btn--ghost btn--block" onClick={onShowTrail}>
        Show this agent's full evidence trail
      </button>
      <p className="inspector__foot">
        Shows observable work only: events, tool calls, test results and approvals. No private model reasoning.
      </p>
    </aside>
  );
}
