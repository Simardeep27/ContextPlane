import assert from "node:assert/strict";
import test from "node:test";

import { answerQuestion, gerund } from "./ask.ts";
import type { ActorRef, AgentKey, HQEvent, PayloadByType } from "./events.ts";
import { project } from "./projection.ts";

let revision = 0;
function ev<T extends HQEvent["type"]>(type: T, role: AgentKey, payload: PayloadByType[T]): HQEvent {
  revision += 1;
  const actor: ActorRef = { kind: "agent", id: `agent_${role}`, role };
  return {
    eventId: `evt_${revision}`,
    type,
    scope: { orgId: "org", projectId: "p" },
    runId: `p:${role}`,
    actor,
    revision,
    cursor: String(revision).padStart(6, "0"),
    occurredAt: new Date(Date.UTC(2026, 8, 26, 14, 0, revision)).toISOString(),
    payload,
  } as HQEvent;
}

function history() {
  revision = 0;
  return [
    ev("run.started", "orders", { agent: "orders", objective: "Update the checkout API", etaMinutes: 30 }),
    ev("change.proposed", "orders", {
      agent: "orders",
      candidateHash: "sha256:x",
      summary: "v2",
      affected: ["billing", "notifications"],
    }),
    ev("run.started", "billing", { agent: "billing", objective: "Adopt currency contract", etaMinutes: 20 }),
    ev("run.blocked", "billing", { agent: "billing", reason: "Waiting for currency contract", waitingOn: "orders" }),
    ev("run.blocked", "orders", { agent: "orders", reason: "Missing staging access", accessRequestId: "a1" }),
    ev("access.requested", "orders", {
      agent: "orders",
      accessRequestId: "a1",
      resource: "demo.staging.orders",
      action: "read",
      purpose: "tests",
      owner: "Dana",
      expiresAt: "2026-09-26T15:00:00.000Z",
    }),
    // A blocked agent's own messages must not make it look busy.
    ev("message.sent", "orders", { from: "orders", to: "pm", body: "Blocked on access", evidenceIds: [] }),
  ];
}

test("change proposal lights up affected agents and links them", () => {
  const view = project(history());
  assert.equal(view.agents.billing.affectedBy?.value, "orders");
  assert.equal(view.agents.notifications.affectedBy?.value, "orders");
  assert.ok(view.links.some((l) => l.from === "orders" && l.to === "notifications"));
  assert.equal(view.links.find((l) => l.from === "billing" && l.to === "orders")?.blocking, true);
});

test("access request holds the agent in waiting_approval until decided", () => {
  const events = history();
  const view = project(events);
  assert.equal(view.agents.orders.state, "waiting_approval");
  assert.equal(view.accessRequests[0]?.status, "pending");

  const approved = project([
    ...events,
    ev("access.decided", "orders", { accessRequestId: "a1", decision: "approved", decidedBy: "Dana" }),
    ev("run.resumed", "orders", { agent: "orders", note: "resuming", etaMinutes: 5 }),
  ]);
  assert.equal(approved.accessRequests[0]?.status, "approved");
  assert.equal(approved.agents.orders.state, "coding");
  assert.equal(approved.agents.orders.blocker, null);
  assert.ok(approved.agents.orders.evidence.some((e) => e.kind === "approval"));
});

test("denial leaves the agent blocked with the reason", () => {
  const view = project([
    ...history(),
    ev("access.decided", "orders", { accessRequestId: "a1", decision: "denied", decidedBy: "Dana" }),
  ]);
  assert.equal(view.agents.orders.state, "blocked");
  assert.match(view.agents.orders.blocker?.value ?? "", /denied by Dana/);
});

test("projection is order-independent by revision", () => {
  const events = history();
  assert.deepEqual(project([...events].reverse()), project(events));
});

test("manager answer cites the events behind each line", () => {
  const view = project(history());
  const answer = answerQuestion("What is everyone working on?", view);
  assert.equal(answer.lines.length, 4);
  const orders = answer.lines.find((l) => l.agent === "orders");
  assert.match(orders?.text ?? "", /blocked until Dana approves read access to demo\.staging\.orders/);
  const eventIds = new Set(view.timeline.map((t) => t.eventId));
  for (const line of answer.lines) for (const c of line.citations) assert.ok(eventIds.has(c.eventId));
  assert.equal(answer.asOfCursor, "000007");
});

test("manager questions can be filtered to blocked agents or one team", () => {
  const view = project(history());
  assert.deepEqual(
    answerQuestion("Who is blocked?", view).lines.map((l) => l.agent),
    ["orders", "billing"],
  );
  assert.deepEqual(answerQuestion("What is billing doing?", view).lines.map((l) => l.agent), ["billing"]);
});

test("imperative objectives read as status sentences", () => {
  assert.equal(gerund("Update the checkout API to v2"), "updating the checkout API to v2");
  assert.equal(gerund("Adopt the v2 currency contract"), "adopting the v2 currency contract");
  assert.equal(gerund("Patch receipt emails"), "patching receipt emails");
});
