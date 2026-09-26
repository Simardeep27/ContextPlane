import { useState } from "react";

import type { AgentKey } from "../shared/events.ts";
import { stateLabels } from "../shared/projection.ts";
import { HQScene } from "./scene/HQScene.tsx";
import { stateColors } from "./scene/layout.ts";
import { ApprovalCard } from "./ui/ApprovalCard.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { ManagerPanel } from "./ui/ManagerPanel.tsx";
import { RuntimePanel } from "./ui/RuntimePanel.tsx";
import { Timeline } from "./ui/Timeline.tsx";
import { TopBar } from "./ui/TopBar.tsx";
import { useEventStream, type Meta } from "./useEventStream.ts";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function App() {
  const { meta, events, runtime, view, live, connection, followProject } = useEventStream();
  const [selected, setSelected] = useState<AgentKey | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<AgentKey | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = view.accessRequests.filter((r) => r.status === "pending");

  const start = async () => {
    setStarting(true);
    setError(null);
    if (meta?.source === "runtime") {
      try {
        await post("/api/runtime/publish");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setStarting(false);
      }
      return;
    }
    try {
      const next = await post<Meta>("/api/scenario/start");
      setSelected(null);
      setHighlight(null);
      setTimelineFilter(null);
      followProject(next.projectId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const cite = (eventId: string) => {
    setTimelineFilter(null);
    setTimelineOpen(true);
    setHighlight(eventId);
  };

  return (
    <div className={`app${timelineOpen ? " app--trail-open" : ""}`}>
      <div className="scene">
        <HQScene view={view} events={events} live={live} selected={selected} onSelect={setSelected} />
      </div>

      <TopBar
        meta={meta}
        connection={connection}
        eventCount={view.timeline.length}
        starting={starting}
        onStart={start}
      />

      <div className="left-column">
        {runtime && <RuntimePanel runtime={runtime} onCite={cite} />}
        {pending.map((request) => (
          <ApprovalCard
            key={request.accessRequestId}
            request={request}
            onInspect={() => setSelected(request.agent)}
            onDecide={async (decision) => {
              await post("/api/access/decide", { accessRequestId: request.accessRequestId, decision });
            }}
          />
        ))}
        <ManagerPanel view={view} onCite={cite} />
        {error && <p className="error panel">{error}</p>}
      </div>

      {selected && (
        <Inspector
          agent={view.agents[selected]}
          onClose={() => setSelected(null)}
          onCite={cite}
          onShowTrail={() => {
            setTimelineFilter(selected);
            setTimelineOpen(true);
            setHighlight(null);
          }}
        />
      )}

      <div className="bottom">
        <Legend />
        <Timeline
          items={view.timeline}
          open={timelineOpen}
          onToggle={() => setTimelineOpen((open) => !open)}
          filter={timelineFilter}
          onClearFilter={() => setTimelineFilter(null)}
          highlight={highlight}
          storeDetail={meta?.store.detail}
        />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="legend panel" aria-label="Agent states">
      {(Object.keys(stateColors) as (keyof typeof stateColors)[])
        .filter((s) => s !== "idle")
        .map((state) => (
          <li key={state}>
            <span className="state-dot" style={{ background: stateColors[state] }} />
            {stateLabels[state]}
          </li>
        ))}
    </ul>
  );
}
