// Reads the Context Plane runtime through its public API (MVP-03) instead of
// touching MongoDB directly, so HQ sees exactly the scoped data agents see.

import { EventEmitter } from "node:events";

import type { EventEnvelope, ProjectProjection } from "@context-plane/contracts";
import { mvp02Scenario } from "@context-plane/scenario";

import type { RuntimeAgent, RuntimeSnapshot } from "../shared/runtime.ts";

// Dev A owns the Orders service and Dev B owns Billing; map them onto the
// matching HQ characters.
export const runtimeAgents: readonly RuntimeAgent[] = mvp02Scenario.developers.map((developer) => ({
  agentId: developer.agentId,
  hqKey: developer.serviceId,
  displayName: `${developer.displayName} (${developer.serviceId === "orders" ? "Orders" : "Billing"})`,
  serviceId: developer.serviceId,
}));

export const runtimeProjectId = mvp02Scenario.scope.projectId;
export const publishedRevision = mvp02Scenario.devBPublication.dependencyRevision;

export class RuntimeSource {
  private readonly emitter = new EventEmitter();
  private events: EventEnvelope[] = [];
  private projection: ProjectProjection | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<boolean> | null = null;
  status: { ok: boolean; detail: string } = { ok: false, detail: "connecting" };

  constructor(private readonly baseUrl: string) {}

  snapshot(): RuntimeSnapshot {
    return { projection: this.projection, events: this.events, agents: runtimeAgents };
  }

  onChange(listener: (snapshot: RuntimeSnapshot) => void) {
    this.emitter.on("change", listener);
    return () => void this.emitter.off("change", listener);
  }

  start(intervalMs = 1000) {
    const tick = async () => {
      try {
        if (await this.refresh()) this.emitter.emit("change", this.snapshot());
        this.status = { ok: true, detail: `Context API · ${this.baseUrl}` };
      } catch (error) {
        this.status = { ok: false, detail: `Context API unreachable: ${(error as Error).message}` };
      }
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async request<T>(path: string, init: RequestInit & { session: "dev-a" | "dev-b" }): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/projects/${encodeURIComponent(runtimeProjectId)}${path}`, {
      ...init,
      headers: { "x-demo-session": init.session, "content-type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as T & { error?: { code: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `HTTP ${response.status}`);
    return body;
  }

  // Single-flight: the poll and a publish-triggered refresh must not page the
  // same cursor concurrently and append the same events twice.
  private refresh(): Promise<boolean> {
    this.inFlight ??= this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  // Returns true when anything changed. Events page by cursor, 100 at a time.
  private async load(): Promise<boolean> {
    let changed = false;
    for (;;) {
      const after = this.events.at(-1)?.cursor ?? "000000";
      const { events } = await this.request<{ events: EventEnvelope[] }>(`/events?after=${after}`, { session: "dev-a" });
      const known = new Set(this.events.map((e) => e.eventId));
      const fresh = events.filter((e) => !known.has(e.eventId));
      if (fresh.length === 0) break;
      this.events = [...this.events, ...fresh];
      changed = true;
      if (events.length < 100) break;
    }
    const projection = await this.request<ProjectProjection>("/projection", { session: "dev-a" });
    if (projection.revision !== this.projection?.revision) {
      this.projection = projection;
      changed = true;
    }
    return changed;
  }

  /**
   * Dev B's scripted publication of dependency revision N+1 (the scenario's
   * only human-triggered runtime action today). Idempotent: the fixed
   * idempotency key makes a repeat a replay.
   */
  async publishDevB() {
    const fixture = mvp02Scenario.devBPublication;
    const current = await this.request<ProjectProjection>("/projection", { session: "dev-b" });
    const result = await this.request<{ replayed: boolean }>("/publications/dev-b", {
      session: "dev-b",
      method: "POST",
      body: JSON.stringify({
        commandId: "command_dev_b_publish_n_plus_1",
        idempotencyKey: "dev-b-publication-n-plus-1",
        expectedRevision: current.revision,
        dependencyId: mvp02Scenario.dependency.dependencyId,
        dependencyRevision: fixture.dependencyRevision,
        artifactHash: fixture.artifact.artifactHash,
        evidenceId: fixture.evidence.evidenceId,
        // Fixed fixture time: a repeat must be byte-identical to replay.
        publishedAt: mvp02Scenario.dependencyRevisions[1]?.publishedAt ?? mvp02Scenario.seededAt,
      }),
    });
    if (await this.refresh()) this.emitter.emit("change", this.snapshot());
    return result;
  }
}
