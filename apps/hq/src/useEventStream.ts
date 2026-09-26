import { useEffect, useMemo, useState } from "react";

import type { HQEvent } from "../shared/events.ts";
import { project } from "../shared/projection.ts";
import { viewFromRuntime, type RuntimeSnapshot } from "../shared/runtime.ts";

export type ScenarioStatus = "idle" | "running" | "awaiting_approval" | "done";

export interface Meta {
  // "runtime": the Context Plane runtime via its API; "scripted": HQ's demo driver.
  source: "runtime" | "scripted";
  projectId: string;
  store: { mode: "mongodb" | "memory" | "runtime"; detail: string; ok: boolean };
  scenario: ScenarioStatus;
}

export type Connection = "connecting" | "live" | "reconnecting";

// Wall-clock receipt time of events that arrived over the live stream (not
// the initial snapshot), so the scene only animates things happening now.
export type LiveReceipts = ReadonlyMap<string, number>;

function addLive(current: LiveReceipts, eventIds: readonly string[]): LiveReceipts {
  if (eventIds.length === 0) return current;
  const next = new Map(current);
  for (const id of eventIds) next.set(id, performance.now());
  while (next.size > 40) next.delete(next.keys().next().value!);
  return next;
}

export function useEventStream() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [events, setEvents] = useState<HQEvent[]>([]);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [live, setLive] = useState<LiveReceipts>(new Map());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    const url = projectId ? `/api/stream?project=${encodeURIComponent(projectId)}` : "/api/stream";
    const source = new EventSource(url);
    let streamProject = projectId;
    let seenRuntimeEvents: Set<string> | null = null;
    setConnection("connecting");

    source.addEventListener("snapshot", (message) => {
      const data = JSON.parse(message.data) as Meta & { events: HQEvent[] };
      streamProject = data.projectId;
      setMeta({ source: data.source, projectId: data.projectId, store: data.store, scenario: data.scenario });
      setEvents(data.events);
      setRuntime(null);
      setLive(new Map());
      setConnection("live");
    });
    source.addEventListener("event", (message) => {
      const event = JSON.parse(message.data) as HQEvent;
      setEvents((current) =>
        current.some((e) => e.revision === event.revision) ? current : [...current, event],
      );
      setLive((current) => addLive(current, [event.eventId]));
    });
    source.addEventListener("runtime", (message) => {
      const data = JSON.parse(message.data) as Meta & { runtime: RuntimeSnapshot };
      setMeta({ source: data.source, projectId: data.projectId, store: data.store, scenario: data.scenario });
      setRuntime(data.runtime);
      // The first snapshot is history; only later arrivals animate.
      const ids = data.runtime.events.map((e) => e.eventId);
      if (seenRuntimeEvents) {
        const fresh = ids.filter((id) => !seenRuntimeEvents!.has(id));
        setLive((current) => addLive(current, fresh));
      }
      seenRuntimeEvents = new Set(ids);
      setConnection("live");
    });
    source.addEventListener("meta", (message) => {
      const next = JSON.parse(message.data) as Meta;
      setMeta(next);
      // A new scripted run lives in a new project; follow it.
      if (next.source === "scripted" && streamProject && next.projectId !== streamProject) setProjectId(next.projectId);
    });
    source.onerror = () => setConnection("reconnecting");

    return () => source.close();
  }, [projectId]);

  const view = useMemo(() => (runtime ? viewFromRuntime(runtime) : project(events)), [runtime, events]);

  return { meta, events, runtime, view, live, connection, followProject: setProjectId };
}
