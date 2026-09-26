import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createHQServer } from "./app.ts";
import type { RuntimeReader } from "./runtime.ts";
import { MemoryStore } from "./store.ts";
import { ScenarioRunner } from "./scenario.ts";

async function listen(app: ReturnType<typeof createHQServer>) {
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

test("runtime is read only, streams actual reader state, and shuts down its reader", async (t) => {
  let started = 0;
  let stopped = 0;
  const reader: RuntimeReader = {
    status: { ok: true, detail: "Test Context API" },
    snapshot: () => ({ projection: null, events: [], agents: [] }),
    onChange: () => () => {}, start: () => { started++; }, stop: async () => { stopped++; },
  };
  const app = createHQServer({ mode: "runtime", runtime: reader });
  t.after(() => app.close());
  const url = await listen(app);
  assert.equal(started, 1);
  const meta = await fetch(`${url}/api/meta`).then((response) => response.json());
  assert.equal(meta.source, "runtime");
  assert.equal(meta.canMutate, false);
  assert.deepEqual(await fetch(`${url}/api/session`).then((response) => response.json()), { capability: null });
  for (const path of ["runtime/publish", "scenario/start", "access/decide"]) {
    const response = await fetch(`${url}/api/${path}`, { method: "POST", headers: { origin: url } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "RUNTIME_READ_ONLY");
  }
  const stream = await fetch(`${url}/api/stream`);
  const body = stream.body!.getReader();
  assert.match(new TextDecoder().decode((await body.read()).value), /event: runtime/);
  await body.cancel();
  await app.close();
  assert.equal(stopped, 1);
});

test("simulation controls require an allowed origin and volatile capability", async (t) => {
  const app = createHQServer({ mode: "simulation", pace: 0 });
  t.after(() => app.close());
  const url = await listen(app);
  const capability = (await fetch(`${url}/api/session`).then((response) => response.json())).capability;
  const base = { "content-type": "application/json", origin: url, "x-hq-capability": capability };
  for (const headers of [
    { ...base, origin: "https://untrusted.example" },
    { ...base, "x-hq-capability": "wrong" },
    { "content-type": "application/json", "x-hq-capability": capability },
    { ...base, "content-type": "text/plain" },
  ]) assert.equal((await fetch(`${url}/api/scenario/start`, { method: "POST", headers, body: "{}" })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    get(`${url}/api/session`, { headers: { host: "untrusted.example" } }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(`${url}/api/session`, { headers: { origin: "https://untrusted.example" } })).status, 403);
  const accepted = await fetch(`${url}/api/scenario/start`, { method: "POST", headers: base, body: "{}" });
  assert.equal(accepted.status, 202);
  const meta = await accepted.json();
  assert.equal(meta.store.mode, "memory");
  assert.match(meta.projectId, /^simulation-/);
  assert.equal((await fetch(`${url}/api/scenario/start`, { method: "POST", headers: base, body: "{}" })).status, 409);
  // Wait for the real playback queue; the subsequent decision must be attributed
  // to the simulation controller, never to a forged authenticated human owner.
  for (let tries = 0; tries < 100; tries++) {
    const current = await fetch(`${url}/api/meta`).then((response) => response.json());
    if (current.scenario === "awaiting_approval") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const decision = await fetch(`${url}/api/access/decide`, { method: "POST", headers: base,
    body: JSON.stringify({ accessRequestId: "access_staging_orders_read", decision: "approved" }) });
  assert.equal(decision.status, 200);
  const event = (await decision.json()).event;
  assert.equal(event.actor.kind, "system");
  assert.equal(event.actor.id, "hq_simulation_controller");
  assert.equal(event.payload.decidedBy, "Simulation viewer");
});

test("stopping playback cancels pending steps without writing more events", async () => {
  const store = new MemoryStore();
  const runner = new ScenarioRunner(store, 1);
  const scope = { orgId: "simulation", projectId: "cancellation" };
  const active = runner.start(scope);
  runner.stop();
  await active;
  assert.deepEqual(await store.list(scope.projectId), []);
});
