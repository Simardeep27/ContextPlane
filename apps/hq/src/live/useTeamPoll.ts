import { useCallback, useEffect, useRef, useState } from "react";

import { agentViews, optimize, type AgentView, type OptimizerReport } from "../../shared/harness.ts";
import { newReports } from "../../shared/live.ts";
import type { TeamSnapshot } from "../../shared/team.ts";

export interface TeamPoll {
  views: AgentView[];
  report: OptimizerReport | null;
  fetchedAt: Date | null;
  error: string | null;
  loading: boolean;
  // performance.now() of the last poll that brought new reports.
  pulseAt: number | null;
  // identity -> performance.now() of its latest new report.
  fresh: ReadonlyMap<string, number>;
  refresh: () => void;
}

function describe(status: number) {
  if (status === 503) return "Live team access is not configured on this deployment.";
  if (status === 403) return "This origin may not read live team data.";
  return `Live team data is unavailable (HTTP ${status}).`;
}

/** Polls the allowlisted /api/team projection. Never spins: failures surface as a message. */
export function useTeamPoll(intervalMs = 5000): TeamPoll {
  const [views, setViews] = useState<AgentView[]>([]);
  const [report, setReport] = useState<OptimizerReport | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulseAt, setPulseAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(new Map());
  const previous = useRef<AgentView[] | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    const controller = new AbortController();
    inflight.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch("/api/team", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(describe(res.status));
      if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("The /api/team endpoint is not available here.");
      const snapshot = (await res.json()) as TeamSnapshot;
      if (!Array.isArray(snapshot.agents)) throw new Error("The team response could not be read.");
      const now = Date.now();
      const input = { agents: snapshot.agents, events: snapshot.events ?? [] };
      const next = agentViews(input, now);
      const changed = newReports(previous.current, next);
      previous.current = next;
      if (changed.length > 0) {
        const at = performance.now();
        setPulseAt(at);
        setFresh((current) => {
          const map = new Map(current);
          for (const id of changed) map.set(id, at);
          return map;
        });
      }
      setViews(next);
      setReport(optimize(input, now));
      setFetchedAt(new Date(snapshot.fetchedAt && Number.isFinite(Date.parse(snapshot.fetchedAt)) ? snapshot.fetchedAt : now));
      setError(null);
    } catch (e) {
      const err = e as Error;
      setError(err.name === "AbortError" ? "The live team request timed out." : err.message === "Failed to fetch" ? "Cannot reach /api/team." : err.message);
    } finally {
      clearTimeout(timeout);
      if (inflight.current === controller) inflight.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    return () => {
      clearInterval(timer);
      inflight.current?.abort();
      inflight.current = null;
    };
  }, [refresh, intervalMs]);

  return { views, report, fetchedAt, error, loading, pulseAt, fresh, refresh: () => void refresh() };
}
