import type { ReactNode } from "react";

import type { Connection, Meta } from "../useEventStream.ts";

const hints: Record<Meta["scenario"], string> = {
  idle: "Simulation: start fictional agent work. No commands or tests will run.",
  running: "Simulation playing. Agent activity and test results are scripted.",
  awaiting_approval: "Simulation paused. Choose a fictional approval or denial to continue.",
  done: "Simulation complete. Timeline entries are examples, not execution receipts.",
};
interface Props { meta: Meta | null; connection: Connection; eventCount: number; starting: boolean; onStart: () => void; children?: ReactNode }
export function TopBar({ meta, connection, eventCount, starting, onStart, children }: Props) {
  const scenario = meta?.scenario ?? "idle";
  const isRuntime = meta?.source === "runtime";
  const busy = !meta?.canMutate || scenario === "running" || scenario === "awaiting_approval" || starting;
  const pillLabel = isRuntime ? (meta.store.ok ? "Runtime · read only" : "Runtime offline") : "Simulation · memory";
  return (
    <header className="topbar panel">
      <div className="brand"><div className="brand__mark" aria-hidden /><div>
        <h1>Context Plane HQ</h1><p>{isRuntime ? "Recorded project state and evidence" : "Fictional agent coordination playback"}</p>
      </div></div>
      <p className="topbar__hint">{isRuntime
        ? "Read-only Context API view. Perform work through authenticated agent clients; this page does not impersonate Dev B."
        : hints[scenario]}</p>
      <div className="topbar__status">
        <span className={`pill pill--${connection}`} title={meta?.store.detail}><span className="pill__dot" />
          {connection === "live" ? pillLabel : connection}
        </span>
        <span className="topbar__meta mono" title="Project scope of the event stream">{meta?.projectId ?? "—"} · {eventCount} events</span>
        {!isRuntime && <button type="button" className="btn btn--primary" disabled={busy} onClick={onStart}>
          {scenario === "done" ? "Replay simulation" : "Start simulation"}
        </button>}
        {children}
      </div>
    </header>
  );
}
