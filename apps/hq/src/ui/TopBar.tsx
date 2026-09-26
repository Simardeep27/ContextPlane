import type { Connection, Meta } from "../useEventStream.ts";

const runtimeHints: Record<"idle" | "done", string> = {
  idle: "Live runtime. Dev B can publish dependency revision N+1; Dev A's agent is still working from N.",
  done: "Dev B published N+1 and Dev A's agent was notified. Later steps appear as the runtime reports them.",
};

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
  const isRuntime = meta?.source === "runtime";
  const busy = scenario === "running" || scenario === "awaiting_approval" || starting ||
    (isRuntime && (scenario === "done" || !meta?.store.ok));
  const pillLabel = meta?.store.mode === "runtime"
    ? (meta.store.ok ? "Runtime live" : "Runtime offline")
    : meta?.store.mode === "mongodb" ? "MongoDB live" : "In-memory";
  const buttonLabel = isRuntime
    ? (scenario === "done" ? "N+1 published" : "Dev B publishes N+1")
    : scenario === "done" || (scenario === "idle" && eventCount > 0) ? "Run again" : "Start checkout API change";
  return (
    <header className="topbar panel">
      <div className="brand">
        <div className="brand__mark" aria-hidden />
        <div>
          <h1>Context Plane HQ</h1>
          <p>Live command center for work performed by AI agents</p>
        </div>
      </div>

      <p className="topbar__hint">{isRuntime ? runtimeHints[scenario === "done" ? "done" : "idle"] : hints[scenario]}</p>

      <div className="topbar__status">
        <span className={`pill pill--${connection}`} title={meta?.store.detail}>
          <span className="pill__dot" />
          {connection === "live" ? pillLabel : connection}
        </span>
        <span className="topbar__meta mono" title="Project scope of the event stream">
          {meta?.projectId ?? "—"} · {eventCount} events
        </span>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onStart}>
          {buttonLabel}
        </button>
      </div>
    </header>
  );
}
