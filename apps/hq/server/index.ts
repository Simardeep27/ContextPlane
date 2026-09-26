import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import type { HQEvent, ProjectScope } from "../shared/events.ts";
import { project } from "../shared/projection.ts";
import { RuntimeSource, publishedRevision, runtimeProjectId } from "./runtime.ts";
import { ScenarioRunner, scenarioAccessRequestId, type ScenarioStatus } from "./scenario.ts";
import { openStore } from "./store.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env file: fall back to the process environment.
}

const port = Number(process.env.PORT ?? 8787);
const orgId = "org_demo";
const store = await openStore();
const runner = new ScenarioRunner(store, Number(process.env.SCENARIO_PACE ?? 1));
let currentProjectId = (await store.latestProjectId()) ?? "checkout-v2-empty";
runner.status = inferStatus(await store.list(currentProjectId));

// Runtime mode: render the real Context Plane runtime through its API
// instead of the scripted demo.
const runtime = process.env.CONTEXT_API_URL ? new RuntimeSource(process.env.CONTEXT_API_URL.replace(/\/$/, "")) : null;
runtime?.start();

if (runtime) console.log(`[hq] runtime mode: ${process.env.CONTEXT_API_URL} (project ${runtimeProjectId})`);
else console.log(`[hq] ${store.detail}\n[hq] current project: ${currentProjectId} (${runner.status})`);

// Recover the scenario phase from history so a restart mid-demo still lets
// the approval continue the run.
function inferStatus(events: HQEvent[]): ScenarioStatus {
  if (events.length === 0) return "idle";
  const view = project(events);
  if (view.agents.pm.state === "complete") return "done";
  if (view.accessRequests.some((r) => r.status === "pending")) return "awaiting_approval";
  // Playback died with the old process; allow a fresh start.
  return view.accessRequests.some((r) => r.status === "denied") ? "done" : "idle";
}

const scope = (projectId: string): ProjectScope => ({ orgId, projectId });

function meta() {
  if (runtime) {
    const published = runtime.snapshot().projection?.dependencies.some((d) => d.revision >= publishedRevision) ?? false;
    return { source: "runtime" as const, projectId: runtimeProjectId,
      store: { mode: "runtime" as const, detail: runtime.status.detail, ok: runtime.status.ok },
      scenario: published ? ("done" as const) : ("idle" as const) };
  }
  return { source: "scripted" as const, projectId: currentProjectId,
    store: { mode: store.mode, detail: store.detail, ok: true }, scenario: runner.status };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

// One SSE connection per project: a snapshot of the full history, then live
// events. Subscribing before reading the snapshot and de-duplicating by
// revision closes the gap between the two.
async function stream(req: IncomingMessage, res: ServerResponse, projectId: string) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const write = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

  if (runtime) {
    write("runtime", { ...meta(), runtime: runtime.snapshot() });
    const off = runtime.onChange((snapshot) => write("runtime", { ...meta(), runtime: snapshot }));
    let lastMeta = JSON.stringify(meta());
    const heartbeat = setInterval(() => {
      const next = JSON.stringify(meta());
      if (next !== lastMeta) write("meta", meta());
      lastMeta = next;
      res.write(": keep-alive\n\n");
    }, 1000);
    req.on("close", () => {
      clearInterval(heartbeat);
      off();
    });
    return;
  }

  let snapshotRevision: number | null = null;
  const buffered: HQEvent[] = [];
  const unsubscribe = store.onEvent((event) => {
    if (event.scope.projectId !== projectId) return;
    if (snapshotRevision === null) buffered.push(event);
    else if (event.revision > snapshotRevision) write("event", event);
  });

  const events = await store.list(projectId);
  snapshotRevision = events.at(-1)?.revision ?? 0;
  write("snapshot", { ...meta(), projectId, events });
  for (const event of buffered) if (event.revision > snapshotRevision) write("event", event);

  let lastMeta = JSON.stringify(meta());
  const heartbeat = setInterval(() => {
    const next = JSON.stringify(meta());
    if (next !== lastMeta) {
      lastMeta = next;
      write("meta", meta());
    }
    res.write(": keep-alive\n\n");
  }, 1000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function decide(res: ServerResponse, body: Record<string, unknown>) {
  const { accessRequestId, decision } = body;
  if (typeof accessRequestId !== "string" || (decision !== "approved" && decision !== "denied")) {
    return sendJson(res, 400, { error: "accessRequestId and decision (approved|denied) are required" });
  }
  const view = project(await store.list(currentProjectId));
  const request = view.accessRequests.find((r) => r.accessRequestId === accessRequestId);
  if (!request) return sendJson(res, 404, { error: `No access request ${accessRequestId} in ${currentProjectId}` });
  if (request.status !== "pending") return sendJson(res, 409, { error: `Request is already ${request.status}` });

  // Decisions are recorded as the resource owner acting as a human, never as
  // an agent: no agent tool can produce this event.
  const event = await store.append(scope(currentProjectId), {
    type: "access.decided",
    runId: `${currentProjectId}:${request.agent}`,
    actor: { kind: "human", id: request.owner, role: "system" },
    payload: { accessRequestId, decision, decidedBy: request.owner },
  });
  if (accessRequestId === scenarioAccessRequestId) {
    void runner.continueAfterDecision(scope(currentProjectId), decision).catch(logFailure);
  }
  sendJson(res, 200, { event });
}

function logFailure(error: unknown) {
  console.error("[hq] scenario failed:", error);
}

const distDir = resolve("dist");
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  let file = join(distDir, path);
  if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
  if (!existsSync(file)) return sendJson(res, 404, { error: "Run `npm run build` first, or use `npm run dev`." });
  res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/stream") {
      return await stream(req, res, url.searchParams.get("project") ?? currentProjectId);
    }
    if (req.method === "GET" && url.pathname === "/api/meta") return sendJson(res, 200, meta());
    if (req.method === "POST" && url.pathname === "/api/runtime/publish") {
      if (!runtime) return sendJson(res, 409, { error: "Runtime mode is off (set CONTEXT_API_URL)" });
      try {
        return sendJson(res, 200, await runtime.publishDevB());
      } catch (error) {
        return sendJson(res, 502, { error: `Context API rejected the publication: ${(error as Error).message}` });
      }
    }
    if (runtime && (url.pathname === "/api/scenario/start" || url.pathname === "/api/access/decide")) {
      return sendJson(res, 409, { error: "Not available in runtime mode: the runtime has no decision endpoint yet" });
    }
    if (req.method === "POST" && url.pathname === "/api/scenario/start") {
      if (runner.status === "running") return sendJson(res, 409, { error: "Scenario is already running" });
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
      currentProjectId = `checkout-v2-${stamp}`;
      void runner.start(scope(currentProjectId)).catch(logFailure);
      return sendJson(res, 202, meta());
    }
    if (req.method === "POST" && url.pathname === "/api/access/decide") return await decide(res, await readJson(req));
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(req, res);
  } catch (error) {
    console.error("[hq] request failed:", error);
    if (!res.headersSent) sendJson(res, 500, { error: (error as Error).message });
    else res.end();
  }
});

server.listen(port, () => console.log(`[hq] API on http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    runtime?.stop();
    void store.close().finally(() => process.exit(0));
  });
}
