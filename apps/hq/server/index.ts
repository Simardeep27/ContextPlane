import { createHQServer } from "./app.ts";
import { RuntimeSource } from "./runtime.ts";

try { process.loadEnvFile(); } catch { /* Environment variables are sufficient. */ }
const port = Number(process.env.PORT ?? 8787);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const mode = process.env.HQ_MODE ?? "runtime";
if (mode !== "runtime" && mode !== "simulation") throw new Error("HQ_MODE must be runtime or simulation");
const browserOrigin = process.env.HQ_BROWSER_ORIGIN ?? "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(browserOrigin).hostname)) throw new Error("HQ_BROWSER_ORIGIN must be loopback");
const app = createHQServer(mode === "runtime"
  ? { mode, runtime: new RuntimeSource(process.env.CONTEXT_API_URL ?? "http://127.0.0.1:3001"), browserOrigin }
  : { mode, pace: Number(process.env.SCENARIO_PACE ?? 1), browserOrigin });
app.server.listen(port, "127.0.0.1", () => console.log(`[hq] ${mode} on http://127.0.0.1:${port}${mode === "runtime" ? " (read only)" : " (fictional playback, memory only)"}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close().catch(() => { process.exitCode = 1; }));
