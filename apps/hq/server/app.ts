import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { HQEvent, ProjectScope } from "../shared/events.ts";
import { project } from "../shared/projection.ts";
import { runtimeProjectId, type RuntimeReader } from "./runtime.ts";
import { ScenarioRunner, scenarioAccessRequestId } from "./scenario.ts";
import { MemoryStore } from "./store.ts";

type HQOptions =
  | { mode: "runtime"; runtime: RuntimeReader; distDir?: string; browserOrigin?: string }
  | { mode: "simulation"; pace?: number; distDir?: string; browserOrigin?: string };

export function createHQServer(options: HQOptions) {
  const runtime = options.mode === "runtime" ? options.runtime : null;
  // There is no alternate database. Only explicit simulation allocates a store.
  const store = options.mode === "simulation" ? new MemoryStore() : null;
  const runner = store ? new ScenarioRunner(store, options.mode === "simulation" ? options.pace ?? 1 : 1) : null;
  const capability = randomBytes(32).toString("hex");
  const streams = new Set<ServerResponse>();
  const distDir = resolve(options.distDir ?? "dist");
  let currentProjectId = "simulation-empty";
  const scope = (): ProjectScope => ({ orgId: "org_hq_simulation", projectId: currentProjectId });
  runtime?.start();

  function meta() {
    if (runtime) return { source: "runtime", projectId: runtimeProjectId,
      store: { mode: "runtime", ...runtime.status }, scenario: "idle", canMutate: false };
    return { source: "scripted", projectId: currentProjectId,
      store: { mode: "memory", detail: store!.detail, ok: true }, scenario: runner!.status, canMutate: true };
  }
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const approvedOrigin = (req: IncomingMessage, origin: string | undefined) => {
    if (!origin) return false;
    const own = `http://${req.headers.host}`;
    return origin === own || origin === options.browserOrigin;
  };
  const localHost = (req: IncomingMessage) => {
    try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${req.headers.host}`).hostname); }
    catch { return false; }
  };
  const permittedMutation = (req: IncomingMessage) => {
    const supplied = req.headers["x-hq-capability"];
    return approvedOrigin(req, req.headers.origin) && req.headers["content-type"]?.split(";")[0] === "application/json" &&
      typeof supplied === "string" && supplied.length === capability.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(capability));
  };
  async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 8192) throw new Error("INVALID_BODY");
    }
    const body: unknown = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_BODY");
    return body as Record<string, unknown>;
  }
  async function stream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    streams.add(res);
    const write = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    let off: () => void;
    if (runtime) {
      // Subscribe before snapshot. Runtime emission and snapshot are synchronous.
      off = runtime.onChange((snapshot) => write("runtime", { ...meta(), runtime: snapshot }));
      write("runtime", { ...meta(), runtime: runtime.snapshot() });
    } else {
      const projectId = currentProjectId;
      let ready = false;
      const buffered: HQEvent[] = [];
      off = store!.onEvent((event) => {
        if (event.scope.projectId !== projectId) return;
        if (ready) write("event", event); else buffered.push(event);
      });
      const events = await store!.list(projectId);
      write("snapshot", { ...meta(), projectId, events });
      const last = events.at(-1)?.revision ?? 0;
      for (const event of buffered) if (event.revision > last) write("event", event);
      ready = true;
    }
    let previous = JSON.stringify(meta());
    const heartbeat = setInterval(() => {
      const next = JSON.stringify(meta());
      if (next !== previous) write("meta", meta());
      previous = next;
      res.write(": keep-alive\n\n");
    }, 1000);
    res.once("close", () => { clearInterval(heartbeat); off(); streams.delete(res); });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!localHost(req)) return json(res, 403, { error: "LOCAL_HOST_REQUIRED" });
      if (req.headers.origin && !approvedOrigin(req, req.headers.origin)) return json(res, 403, { error: "ORIGIN_FORBIDDEN" });
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/meta") return json(res, 200, meta());
      if (req.method === "GET" && url.pathname === "/api/session") {
        // Same-origin browser fetch can read this, cross-origin sites cannot.
        return json(res, 200, { capability: runtime ? null : capability });
      }
      if (req.method === "GET" && url.pathname === "/api/stream") return await stream(req, res);
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (runtime) return json(res, 403, { error: "RUNTIME_READ_ONLY" });
        if (!permittedMutation(req)) return json(res, 403, { error: "SIMULATION_CAPABILITY_REQUIRED" });
        if (url.pathname === "/api/scenario/start") {
          if (runner!.status === "running" || runner!.status === "awaiting_approval") return json(res, 409, { error: "Simulation already active" });
          currentProjectId = `simulation-${randomBytes(8).toString("hex")}`;
          void runner!.start(scope()).catch(() => runner!.stop());
          return json(res, 202, meta());
        }
        if (url.pathname === "/api/access/decide") {
          const body = await bodyOf(req);
          if (Object.keys(body).some((key) => key !== "accessRequestId" && key !== "decision") ||
              typeof body.accessRequestId !== "string" || (body.decision !== "approved" && body.decision !== "denied")) {
            return json(res, 400, { error: "INVALID_DECISION" });
          }
          const view = project(await store!.list(currentProjectId));
          const request = view.accessRequests.find((request) => request.accessRequestId === body.accessRequestId);
          if (!request) return json(res, 404, { error: "Unknown simulated request" });
          if (request.status !== "pending" || runner!.status !== "awaiting_approval") return json(res, 409, { error: "Simulation is not awaiting this decision" });
          // A simulation controller is not an authenticated resource owner.
          runner!.status = "running";
          const event = await store!.append(scope(), { type: "access.decided", runId: `${currentProjectId}:${request.agent}`,
            actor: { kind: "system", id: "hq_simulation_controller", role: "system" },
            payload: { accessRequestId: request.accessRequestId, decision: body.decision, decidedBy: "Simulation viewer" } });
          if (request.accessRequestId === scenarioAccessRequestId) void runner!.continueAfterDecision(scope(), body.decision).catch(() => runner!.stop());
          return json(res, 200, { event });
        }
      }
      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
      const path = normalize(decodeURIComponent(url.pathname));
      let file = join(distDir, path);
      if (!file.startsWith(`${distDir}${sep}`) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
      if (!existsSync(file)) return json(res, 404, { error: "Build HQ or use the Vite development server" });
      const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
      if (req.method === "HEAD") res.end(); else createReadStream(file).pipe(res);
    } catch {
      if (!res.headersSent) json(res, 400, { error: "INVALID_REQUEST" }); else res.end();
    }
  });
  let closing: Promise<void> | null = null;
  return { server, close() {
    closing ??= (async () => {
    runner?.stop();
    for (const res of streams) res.end();
    const closed = server.listening ? new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) : Promise.resolve();
    server.closeAllConnections();
    await Promise.all([runtime?.stop(), store?.close(), closed]);
    })();
    return closing;
  } };
}
