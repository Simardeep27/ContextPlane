import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { answerLive, displayName, legendState, liveHeader, statusLabels } from "../../shared/live.ts";
import { stateColors } from "../scene/layout.ts";
import { clock, relative, useNow } from "../ui/format.ts";
import { LiveScene, statusColor } from "./LiveScene.tsx";
import { useTeamPoll } from "./useTeamPoll.ts";

const suggestions = ["What is everyone working on?", "Who is blocked?", "What has finished?"];

export function LiveApp({ switcher, onSimulation }: { switcher: ReactNode; onSimulation: () => void }) {
  const poll = useTeamPoll(5000);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(suggestions[0]!);
  const [question, setQuestion] = useState(suggestions[0]!);
  const answer = useMemo(() => answerLive(question, poll.views), [question, poll.views]);
  const agent = poll.views.find((v) => v.identity === selected) ?? null;
  const hasData = poll.fetchedAt !== null;
  const now = useNow(5000);

  const pill = hasData
    ? liveHeader(poll.views.length, poll.fetchedAt)
    : poll.loading ? "Live · loading team" : "Live · unavailable";

  return (
    <div className="app app--live">
      <div className="scene">
        <LiveScene views={poll.views} pulseAt={poll.pulseAt} fresh={poll.fresh} selected={selected} onSelect={setSelected}
          brainNote={poll.report?.suggestion ?? null} />
      </div>

      <header className="topbar panel">
        <div className="brand"><div className="brand__mark" aria-hidden /><div>
          <h1>Context Plane HQ</h1><p>Live view of the real team's agents</p>
        </div></div>
        <p className="topbar__hint live-hint" title={poll.report ? `Optimizer: ${poll.report.suggestion}` : undefined}>{poll.report
          ? <>Optimizer: {poll.report.suggestion}</>
          : "Read-only projection of the team's shared work-status. Polls every 5 seconds."}</p>
        <div className="topbar__status">
          <span className={`pill pill--team ${hasData && !poll.error ? "pill--live" : poll.error ? "pill--reconnecting" : ""}`}
            title={poll.error ?? "Allowlisted /api/team projection"}>
            <span className="pill__dot" />{pill}
          </span>
          {switcher}
        </div>
      </header>

      <div className="left-column">
        {poll.error && (
          <section className="panel live-error" role="alert">
            <h2>{hasData ? "Last refresh failed" : "Live team data is unavailable"}</h2>
            <p>{poll.error}{hasData ? " Showing the last successful snapshot." : ""}</p>
            <div className="live-error__actions">
              <button type="button" className="btn btn--small" onClick={poll.refresh}>Retry now</button>
              <button type="button" className="btn btn--small btn--primary" onClick={onSimulation}>Open Simulation</button>
            </div>
          </section>
        )}
        <section className="manager panel">
          <h2>Ask the command center</h2>
          <form className="manager__form" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setQuestion(draft.trim()); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Question for the command center" />
            <button type="submit" className="btn btn--small">Ask</button>
          </form>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s} type="button" className={`chip${s === question ? " is-active" : ""}`} onClick={() => { setDraft(s); setQuestion(s); }}>{s}</button>
            ))}
          </div>
          <div className="answer">
            <p className="answer__meta">
              {hasData ? <><span className="live-dot" /> {answer.heading} · as of {clock(poll.fetchedAt!.toISOString())}</> : "Waiting for live team data"}
            </p>
            {answer.lines.length === 0 ? (
              <p className="muted">{hasData ? answer.empty : "No live data yet."}</p>
            ) : (
              <ul className="answer__lines">
                {answer.lines.map((line) => (
                  <li key={line.identity}>
                    <span className="state-dot" style={{ background: statusColor(line.status) }} />
                    <button type="button" className="live-answer" title={line.text} onClick={() => setSelected(line.identity)}>{line.text}</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="answer__foot">Hover an answer for the full text; click it to open the agent. Built only from the live team projection. No model summarization.</p>
          </div>
        </section>
      </div>

      {agent && (
        <aside className="inspector panel" style={{ "--agent": statusColor(agent.status), "--state": statusColor(agent.status) } as CSSProperties}>
          <header className="inspector__head">
            <div>
              <h2 className="mono">{agent.suffix}</h2>
              <p className="muted">{displayName(agent.person)} · <span className="mono">{agent.identity}</span></p>
            </div>
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          </header>
          <div className="inspector__state"><span className="state-chip">{statusLabels[agent.status]}</span></div>
          <div className="field"><div className="field__label">Task</div><div className="field__value">{agent.task ?? "Not reported"}</div></div>
          <div className="field"><div className="field__label">Summary</div><div className="field__value">{agent.summary ?? "Not reported"}</div></div>
          <div className="field"><div className="field__label">Last update</div><div className="field__value">
            {agent.updatedAt ? <>{clock(agent.updatedAt)} · {relative(agent.updatedAt, now)}</> : "Not reported"}
          </div></div>
          {agent.files.length > 0 && (
            <div className="field"><div className="field__label">Files</div><div className="field__value mono">{agent.files.slice(0, 8).join(", ")}</div></div>
          )}
        </aside>
      )}

      <div className="bottom">
        <ul className="legend panel" aria-label="Agent statuses">
          {(["working", "blocked", "finished", "idle"] as const).map((s) => (
            <li key={s}><span className="state-dot" style={{ background: stateColors[legendState(s)] }} />{statusLabels[s]}</li>
          ))}
          <li className="muted">Robots report into the company brain · <a href="/team.html">Detailed team view</a></li>
        </ul>
      </div>
    </div>
  );
}
