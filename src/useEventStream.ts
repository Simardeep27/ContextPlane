import { useEffect, useMemo, useState } from "react";

import type { HQEvent } from "../shared/events.ts";
import { project } from "../shared/projection.ts";

export type ScenarioStatus = "idle" | "running" | "awaiting_approval" | "done";

export interface Meta {
  projectId: string;
  store: { mode: "mongodb" | "memory"; detail: string };
  scenario: ScenarioStatus;
}

export type Connection = "connecting" | "live" | "reconnecting";

// Wall-clock receipt time of events that arrived over the live stream (not
// the initial snapshot), so the scene only animates things happening now.
export type LiveReceipts = ReadonlyMap<string, number>;

export function useEventStream() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [events, setEvents] = useState<HQEvent[]>([]);
  const [live, setLive] = useState<LiveReceipts>(new Map());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    const url = projectId ? `/api/stream?project=${encodeURIComponent(projectId)}` : "/api/stream";
    const source = new EventSource(url);
    let streamProject = projectId;
    setConnection("connecting");

    source.addEventListener("snapshot", (message) => {
      const data = JSON.parse(message.data) as Meta & { events: HQEvent[] };
      streamProject = data.projectId;
      setMeta({ projectId: data.projectId, store: data.store, scenario: data.scenario });
      setEvents(data.events);
      setLive(new Map());
      setConnection("live");
    });
    source.addEventListener("event", (message) => {
      const event = JSON.parse(message.data) as HQEvent;
      setEvents((current) =>
        current.some((e) => e.revision === event.revision) ? current : [...current, event],
      );
      setLive((current) => {
        const next = new Map(current);
        next.set(event.eventId, performance.now());
        if (next.size > 40) next.delete(next.keys().next().value!);
        return next;
      });
    });
    source.addEventListener("meta", (message) => {
      const next = JSON.parse(message.data) as Meta;
      setMeta(next);
      // A new scenario run lives in a new project; follow it.
      if (streamProject && next.projectId !== streamProject) setProjectId(next.projectId);
    });
    source.onerror = () => setConnection("reconnecting");

    return () => source.close();
  }, [projectId]);

  const view = useMemo(() => project(events), [events]);

  return { meta, events, view, live, connection, followProject: setProjectId };
}
