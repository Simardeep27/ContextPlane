import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { answerLive, companyInsights, companyStatus, displayName, initialPanelState, INSIGHT_PERIOD_MS, insightIndex, legendState, liveHeader,
  PANEL_STORAGE_KEY, sceneShift, statusLabels, type PanelState } from "../../shared/live.ts";
import { BrainIcon, BrandMark } from "../ui/BrandMark.tsx";
import { useReducedMotion } from "../ui/useReducedMotion.ts";
import { stateColors } from "../scene/layout.ts";
import { clock, relative, useNow } from "../ui/format.ts";
import { LiveScene, statusColor } from "./LiveScene.tsx";
import { CompanyEvaluator } from "../ui/CompanyEvaluator.tsx";
import { useTeamPoll } from "./useTeamPoll.ts";

const suggestions = ["What is everyone working on?", "Who is blocked?", "What has finished?"];

export function LiveApp({ switcher, onSimulation }: { switcher: ReactNode; onSimulation: () => void }) {
  const poll = useTeamPoll(5000);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(suggestions[0]!);
  const [question, setQuestion] = useState(suggestions[0]!);
  const answer = useMemo(() => answerLive(question, poll.views), [question, poll.views]);
  const [chat, setChat] = useState<{role:'user'|'assistant';content:string}[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatModel, setChatModel] = useState('');
  async function askCompany(text: string) {
    if (!text.trim() || chatBusy) return;
    setQuestion(text); setChatBusy(true); setChatError('');
    try {
      const response = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:text,history:chat.slice(-6).map(m=>({...m,content:m.content.slice(0,2000)}))}),signal:AbortSignal.timeout(40000)});
      const data = await response.json();
      if (!response.ok) throw Error(data.error === 'CHAT_NOT_CONFIGURED' ? 'Server chat key is not configured.' : data.error === 'CHAT_CREDITS_REQUIRED' ? 'OpenRouter needs credits.' : 'Company chat is unavailable. Please retry.');
      setChat(prev=>[...prev,{role:'user',content:text},{role:'assistant',content:data.answer}].slice(-8) as typeof prev); setChatModel(data.model ?? 'OpenRouter');
    } catch (e) { setChatError(e instanceof Error ? e.message : 'Company chat failed.'); }
    finally { setChatBusy(false); }
  }
  const agent = poll.views.find((v) => v.identity === selected) ?? null;
  const hasData = poll.fetchedAt !== null;
  const now = useNow(5000);
  const still = useReducedMotion();
  const [panel, setPanelState] = useState<PanelState>(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(PANEL_STORAGE_KEY); } catch { /* storage unavailable */ }
    return initialPanelState(stored, typeof innerWidth === "number" ? innerWidth : 1440);
  });
  const setPanel = (next: PanelState) => {
    setPanelState(next);
    try { localStorage.setItem(PANEL_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  };
  const [width, setWidth] = useState(() => (typeof innerWidth === "number" ? innerWidth : 1440));
  useEffect(() => { const on = () => setWidth(innerWidth); addEventListener("resize", on); return () => removeEventListener("resize", on); }, []);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [inspectorMin, setInspectorMin] = useState(false);
  const insights = useMemo(() => companyInsights(poll.report, poll.views), [poll.report, poll.views]);
  const status = companyStatus(poll.report);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), INSIGHT_PERIOD_MS); return () => clearInterval(t); }, []);
  const thinking = insights[insightIndex(insights.length, tick * INSIGHT_PERIOD_MS)] ?? null;
  const openCompany = () => { setSelected(null); setCompanyOpen(true); };
  const selectAgent = (id: string | null) => { setSelected(id); if (id) { setCompanyOpen(false); setInspectorMin(false); } };
  const counts = poll.report;

  const pill = hasData
    ? liveHeader(poll.views.length, poll.fetchedAt)
    : poll.loading ? "Live · loading team" : "Live · unavailable";

  return (
    <div className="app app--live">
      <CompanyEvaluator/>
      <div className="scene">
        <LiveScene views={poll.views} pulseAt={poll.pulseAt} fresh={poll.fresh} selected={selected} onSelect={selectAgent}
          still={still} shift={sceneShift(width, panel)} onOpenCompany={openCompany}
          company={
            <button type="button" className={`company-label company-label--${status.tone}`} onClick={openCompany} aria-label="Open company agent insights">
              <span className="company-label__head"><BrainIcon size={18} label={null} /><strong>Company agent</strong><span className="company-label__role">· harness optimizer</span></span>
              <span className="company-label__chip">{status.label}</span>
              {thinking && <span key={thinking} className="company-label__thinking" title={thinking}>{thinking}</span>}
            </button>
          } />
      </div>

      <header className="topbar panel">
        <div className="brand"><BrandMark size={34} /><div>
          <h1>Company Harness</h1><p>Live HQ · the real team's agents</p>
        </div></div>
        <p className="topbar__hint live-hint">{counts
          ? `${counts.active} active · ${counts.blocked} blocked · ${counts.finished} finished · ${counts.idle} idle`
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
        {panel === "collapsed" ? (
          <button type="button" className="panel manager-pill" onClick={() => setPanel("open")} aria-expanded={false}>
            <span className="live-dot" /> Ask the command center <span aria-hidden>▸</span>
          </button>
        ) : (
        <section className={`manager panel${panel === "max" ? " manager--max" : ""}`}>
          <header className="manager__head">
            <h2>Ask the command center</h2>
            <div className="manager__tools">
              <button type="button" className="btn btn--ghost btn--icon" aria-label={panel === "max" ? "Restore panel size" : "Maximize panel"}
                title={panel === "max" ? "Restore" : "Maximize"} onClick={() => setPanel(panel === "max" ? "open" : "max")}>{panel === "max" ? "▭" : "⤢"}</button>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Minimize panel" title="Minimize" onClick={() => setPanel("collapsed")}>–</button>
            </div>
          </header>
          <form className="manager__form" onSubmit={(e) => { e.preventDefault(); void askCompany(draft.trim()); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} aria-label="Question for the command center" />
            <button type="submit" disabled={chatBusy} className="btn btn--small">{chatBusy ? "Thinking…" : "Ask company"}</button>
          </form>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s} type="button" className={`chip${s === question ? " is-active" : ""}`} onClick={() => { setDraft(s); void askCompany(s); }}>{s}</button>
            ))}
          </div>
          <div className="answer">
            {chatError && <p role="alert">{chatError}</p>}
            <div aria-live="polite">{chat.map((m,i)=><div key={i}><strong>{m.role==='user'?'You':'Company'}</strong><p style={{whiteSpace:'pre-wrap'}}>{m.content}</p></div>)}{chatBusy && <p>Reading shared context and thinking…</p>}</div>
            {chat.length > 0 && <small>{chatModel} · live context · read-only answers</small>}
            <details open={chat.length === 0}><summary>Live status reports</summary>
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
                    <button type="button" className="live-answer" title={line.text} onClick={() => selectAgent(line.identity)}>{line.text}</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="answer__foot">Status rows come directly from reports. Company answers use OpenRouter and may be mistaken.</p>
            </details>
          </div>
        </section>
        )}
      </div>

      {agent && (
        <aside className={`inspector panel${inspectorMin ? " is-min" : ""}`} style={{ "--agent": statusColor(agent.status), "--state": statusColor(agent.status) } as CSSProperties}>
          <header className="inspector__head">
            <div>
              <h2 className="mono">{agent.suffix}</h2>
              <p className="muted">{displayName(agent.person)} · <span className="mono">{agent.identity}</span></p>
            </div>
            <div className="manager__tools">
              <button type="button" className="btn btn--ghost btn--icon" aria-label={inspectorMin ? "Expand details" : "Collapse details"}
                aria-expanded={!inspectorMin} onClick={() => setInspectorMin((v) => !v)}>{inspectorMin ? "▾" : "–"}</button>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={() => setSelected(null)}>×</button>
            </div>
          </header>
          {!inspectorMin && <>
          <div className="inspector__state"><span className="state-chip">{statusLabels[agent.status]}</span></div>
          <div className="field"><div className="field__label">Task</div><div className="field__value">{agent.task ?? "Not reported"}</div></div>
          <div className="field"><div className="field__label">Summary</div><div className="field__value">{agent.summary ?? "Not reported"}</div></div>
          <div className="field"><div className="field__label">Last update</div><div className="field__value">
            {agent.updatedAt ? <>{clock(agent.updatedAt)} · {relative(agent.updatedAt, now)}</> : "Not reported"}
          </div></div>
          {agent.files.length > 0 && (
            <div className="field"><div className="field__label">Files</div><div className="field__value mono">{agent.files.slice(0, 8).join(", ")}</div></div>
          )}
          </>}
        </aside>
      )}

      {companyOpen && !agent && (
        <aside className={`inspector panel company-panel${inspectorMin ? " is-min" : ""}`} style={{ "--agent": "#2dd4bf", "--state": "#2dd4bf" } as CSSProperties} aria-label="Company agent insights">
          <header className="inspector__head">
            <div className="company-panel__title">
              <BrainIcon size={22} label={null} />
              <div><h2>Company agent</h2><p className="muted">Harness optimizer · rule-based, no model calls</p></div>
            </div>
            <div className="manager__tools">
              <button type="button" className="btn btn--ghost btn--icon" aria-label={inspectorMin ? "Expand insights" : "Collapse insights"}
                aria-expanded={!inspectorMin} onClick={() => setInspectorMin((v) => !v)}>{inspectorMin ? "▾" : "–"}</button>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={() => setCompanyOpen(false)}>×</button>
            </div>
          </header>
          {!inspectorMin && <>
            <div className="inspector__state"><span className="state-chip">{status.label}</span>
              {counts && <span className="muted">{counts.eventsLastHour} events in the last hour</span>}</div>
            <h3>Insights</h3>
            <ol className="company-insights">
              {insights.map((line) => <li key={line} className={line === thinking ? "is-current" : undefined}>{line}</li>)}
            </ol>
            <p className="inspector__foot">Computed from the allowlisted team projection each poll. <a href="/team.html">Open the detailed team view →</a></p>
          </>}
        </aside>
      )}

      <div className="bottom">
        <ul className="legend panel" aria-label="Agent statuses">
          {(["working", "blocked", "finished", "idle"] as const).map((s) => (
            <li key={s}><span className="state-dot" style={{ background: stateColors[legendState(s)] }} />{statusLabels[s]}</li>
          ))}
          <li className="muted">Robots report into the company agent · <a href="/team.html">Detailed team view</a></li>
        </ul>
      </div>
    </div>
  );
}
