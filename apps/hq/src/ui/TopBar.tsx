import type { Connection, Meta } from "../useEventStream.ts";

const hints: Record<Meta["scenario"], string> = {
  idle: "Start a checkout API change to watch the agents coordinate.",
  running: "Agents are working. Click any agent to inspect it.",
  awaiting_approval: "The Orders agent is blocked on staging access. Approve its request to continue.",
  done: "Rollout complete. Open the evidence trail to audit every step.",
};

interface Props {
  meta: Meta | null;
  connection: Connection;
  eventCount: number;
  starting: boolean;
  onStart: () => void;
}

export function TopBar({ meta, connection, eventCount, starting, onStart }: Props) {
  const scenario = meta?.scenario ?? "idle";
  const busy = scenario === "running" || scenario === "awaiting_approval" || starting;
  return (
    <header className="topbar panel">
      <div className="brand">
        <div className="brand__mark" aria-hidden />
        <div>
          <h1>Context Plane HQ</h1>
          <p>Live command center for work performed by AI agents</p>
        </div>
      </div>

      <p className="topbar__hint">{hints[scenario]}</p>

      <div className="topbar__status">
        <span className={`pill pill--${connection}`} title={meta?.store.detail}>
          <span className="pill__dot" />
          {connection === "live" ? (meta?.store.mode === "mongodb" ? "MongoDB live" : "In-memory") : connection}
        </span>
        <span className="topbar__meta mono" title="Project scope of the event stream">
          {meta?.projectId ?? "—"} · {eventCount} events
        </span>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onStart}>
          {scenario === "done" || scenario === "idle" && eventCount > 0 ? "Run again" : "Start checkout API change"}
        </button>
      </div>
    </header>
  );
}
