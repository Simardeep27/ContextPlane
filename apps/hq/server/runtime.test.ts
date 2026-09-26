import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { mvp02Scenario } from "@context-plane/scenario";
import { RuntimeSource, runtimeProjectId } from "./runtime.ts";

const scope = mvp02Scenario.scope;
function projection(revision: number, cursor: string) {
  return { scope, revision, eventCursor: cursor, policyEpoch: 1, runs: [], accessRequests: [], dependencies: [],
    addressedMessages: [], timeline: [], rawPrompt: "must-not-leak" };
}
function event(index: number) {
  return { scope, eventId: `event:${index}`, revision: index, cursor: String(index).padStart(6, "0"), type: "dependency.published",
    occurredAt: "2026-09-26T10:00:00Z", runId: "run_test", actor: { kind: "agent", id: "agent_test", role: "billing" },
    payload: { dependencyRevision: 8, evidenceIds: [`evidence:${index}`], hiddenReasoning: "must-not-leak" }, rawPrompt: "must-not-leak" };
}

test("actual HTTP reader pages, deduplicates concurrent polls, sanitizes and rebuilds after restart", async (t) => {
  const requests: string[] = [];
  let revision = 2;
  let cursor = "000101";
  let fail = false;
  const api = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers["x-demo-session"], "dev-a");
    requests.push(req.url!);
    res.setHeader("content-type", "application/json");
    if (fail) { res.statusCode = 503; res.end(JSON.stringify({ error: "private-hostname-and-credentials" })); return; }
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname.endsWith("/projection")) res.end(JSON.stringify(projection(revision, cursor)));
    else {
      const after = Number(url.searchParams.get("after"));
      const all = Array.from({ length: 101 }, (_, index) => event(index + 1));
      res.end(JSON.stringify({ events: all.filter((item) => Number(item.cursor) > after).slice(0, 100) }));
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => new Promise<void>((resolve) => { api.closeAllConnections(); api.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const source = new RuntimeSource(base);
  t.after(() => source.stop());
  let emitted = 0;
  source.onChange(() => { emitted++; });
  await Promise.all([source.refresh(), source.refresh(), source.refresh()]);
  assert.equal(emitted, 1);
  assert.equal(source.snapshot().events.length, 101);
  assert.equal(requests.length, 3);
  assert(requests.every((path) => path.startsWith(`/v1/projects/${runtimeProjectId}/`)));
  assert(!JSON.stringify(source.snapshot()).includes("must-not-leak"));
  assert.equal(await source.refresh(), false);
  const restarted = new RuntimeSource(base);
  await restarted.refresh();
  assert.deepEqual(restarted.snapshot(), source.snapshot());
  await restarted.stop();
  fail = true;
  await source.refresh();
  assert.equal(source.status.ok, false);
  assert(!source.status.detail.includes("private-hostname"));
  assert.equal(source.snapshot().events.length, 101);
  fail = false;
  revision = 1; cursor = "000000";
  await source.refresh();
  assert.equal(source.snapshot().events.length, 0);
  await source.stop();
  const count = requests.length;
  await source.refresh();
  assert.equal(requests.length, count);
});

test("credentials cannot enter runtime URLs or UI connection details", () => {
  assert.throws(() => new RuntimeSource("https://user:secret@example.test"), /without credentials/);
  assert.throws(() => new RuntimeSource("https://example.test?token=secret"), /without credentials/);
});
