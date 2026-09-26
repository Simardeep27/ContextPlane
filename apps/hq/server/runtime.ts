// Read-only MVP-03 adapter. No database connection or acting-agent command.
import { EventEmitter } from "node:events";
import type { EventEnvelope, ProjectProjection } from "@context-plane/contracts";
import { mvp02Scenario } from "@context-plane/scenario";
import type { RuntimeAgent, RuntimeSnapshot } from "../shared/runtime.ts";

export const runtimeAgents: readonly RuntimeAgent[] = mvp02Scenario.developers.map((developer) => ({
  agentId: developer.agentId,
  hqKey: developer.serviceId,
  displayName: `${developer.displayName} (${developer.serviceId === "orders" ? "Orders" : "Billing"})`,
  serviceId: developer.serviceId,
}));
export const runtimeProjectId = mvp02Scenario.scope.projectId;

function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

// The browser receives presentation fields, never arbitrary event payloads,
// future private fields, provider prompts or connection configuration.
function displayProjection(value: ProjectProjection): ProjectProjection {
  return {
    ...pick(value, ["revision", "eventCursor", "policyEpoch"]),
    scope: pick(value.scope, ["orgId", "projectId"]),
    ...(value.candidateVersion ? { candidateVersion: pick(value.candidateVersion, ["candidateHash", "dependencyRevision", "policyEpoch"]) } : {}),
    runs: value.runs.map((run) => pick(run, ["runId", "ownerAgentId", "status", "summary", "blocker", "checkpointRevision", "evidenceIds"])),
    accessRequests: value.accessRequests.map((request) => pick(request, ["accessRequestId", "requesterAgentId", "resource", "action", "purpose", "requestHash", "status", "ownerUserId", "expiresAt", "revision"])),
    dependencies: value.dependencies.map((dependency) => pick(dependency, ["dependencyId", "providerServiceId", "consumerServiceId", "revision", "artifactHash", "evidenceIds"])),
    addressedMessages: value.addressedMessages.map((message) => pick(message, ["messageId", "senderAgentId", "recipientAgentId", "body", "dependencyRevision", "evidenceIds"])),
    timeline: value.timeline.map((entry) => pick(entry, ["eventId", "cursor", "type", "summary", "evidenceIds"])),
  };
}

function displayEvent(event: EventEnvelope): EventEnvelope {
  const source = event.payload as Record<string, unknown> | null;
  const payload: Record<string, unknown> = {};
  for (const key of ["commandId", "dependencyId", "evidenceId"]) {
    if (typeof source?.[key] === "string") payload[key] = source[key];
  }
  if (Number.isSafeInteger(source?.dependencyRevision)) payload.dependencyRevision = source!.dependencyRevision;
  if (Array.isArray(source?.evidenceIds)) payload.evidenceIds = source.evidenceIds.filter((id) => typeof id === "string");
  return { ...pick(event, ["eventId", "type", "runId", "revision", "cursor", "occurredAt"]),
    scope: pick(event.scope, ["orgId", "projectId"]), actor: pick(event.actor, ["kind", "id", "role"]), payload };
}

export interface RuntimeReader {
  status: { ok: boolean; detail: string };
  snapshot(): RuntimeSnapshot;
  onChange(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  start(intervalMs?: number): void;
  stop(): Promise<void>;
}

export class RuntimeSource implements RuntimeReader {
  private readonly emitter = new EventEmitter();
  private events: EventEnvelope[] = [];
  private projection: ProjectProjection | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<boolean> | null = null;
  private readonly abort = new AbortController();
  private readonly baseUrl: string;
  status = { ok: false, detail: "Connecting to the Context API (read only)" };

  constructor(baseUrl: string) {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("CONTEXT_API_URL must be an HTTP(S) URL without credentials, query or fragment");
    }
    this.baseUrl = url.href.replace(/\/$/, "");
  }

  snapshot(): RuntimeSnapshot {
    return { projection: this.projection, events: this.events, agents: runtimeAgents };
  }

  onChange(listener: (snapshot: RuntimeSnapshot) => void) {
    this.emitter.on("change", listener);
    return () => void this.emitter.off("change", listener);
  }

  start(intervalMs = 1000) {
    if (this.timer || this.abort.signal.aborted) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    await this.inFlight;
    this.emitter.removeAllListeners();
  }

  // A single poll owns state and emission even when called concurrently.
  refresh(): Promise<boolean> {
    if (this.abort.signal.aborted) return Promise.resolve(false);
    this.inFlight ??= this.load().then((changed) => {
      this.status = { ok: true, detail: "Context API connected · read only · backing store not asserted" };
      if (changed) this.emitter.emit("change", this.snapshot());
      return changed;
    }).catch(() => {
      // Connection strings, hostnames and raw upstream errors never reach UI.
      this.status = { ok: false, detail: "Context API unavailable · last received state may be stale" };
      return false;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(runtimeProjectId)}${path}`, {
      headers: { "x-demo-session": "dev-a" },
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error("Context API rejected the read");
    return await response.json() as T;
  }

  private async load(): Promise<boolean> {
    // Capture a projection first; display only events at or before its cursor.
    const projection = displayProjection(await this.request<ProjectProjection>("/projection"));
    if (projection.scope.orgId !== mvp02Scenario.scope.orgId || projection.scope.projectId !== runtimeProjectId) {
      throw new Error("Projection scope mismatch");
    }
    let events = this.events;
    // A reset is visible as a lower projection revision or cursor.
    if (projection.revision < (this.projection?.revision ?? 0) || Number(projection.eventCursor) < Number(this.projection?.eventCursor ?? 0)) events = [];
    while (Number(events.at(-1)?.cursor ?? 0) < Number(projection.eventCursor)) {
      const after = events.at(-1)?.cursor ?? "000000";
      const page = await this.request<{ events: EventEnvelope[] }>(`/events?after=${encodeURIComponent(after)}`);
      const known = new Set(events.map((event) => event.eventId));
      const fresh = page.events.filter((event) => !known.has(event.eventId) && Number(event.cursor) <= Number(projection.eventCursor)).map(displayEvent);
      if (fresh.length === 0) throw new Error("Incomplete event history");
      for (const event of fresh) {
        if (event.scope.orgId !== projection.scope.orgId || event.scope.projectId !== projection.scope.projectId ||
          !Number.isSafeInteger(Number(event.cursor)) || Number(event.cursor) <= Number(after)) throw new Error("Event scope or cursor mismatch");
      }
      events = [...events, ...fresh].sort((a, b) => Number(a.cursor) - Number(b.cursor));
      if (events.length > 20_000) throw new Error("Demo history limit exceeded");
    }
    const changed = events.length !== this.events.length || projection.revision !== this.projection?.revision;
    this.events = events;
    this.projection = projection;
    return changed;
  }
}
