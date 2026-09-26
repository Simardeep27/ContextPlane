import assert from "node:assert/strict";
import test from "node:test";

import type { EventEnvelope, ProjectProjection } from "@context-plane/contracts";

import { viewFromRuntime, type RuntimeAgent } from "./runtime.ts";

const agents: RuntimeAgent[] = [
  { agentId: "agent_dev_a", hqKey: "orders", displayName: "Dev A (Orders)", serviceId: "orders" },
  { agentId: "agent_dev_b", hqKey: "billing", displayName: "Dev B (Billing)", serviceId: "billing" },
];
const scope = { orgId: "org_demo", projectId: "project_context_plane" } as ProjectProjection["scope"];

const published = {
  eventId: "event:abc",
  type: "dependency.published",
  scope,
  runId: "run_mvp_03_dev_b_publication",
  actor: { kind: "agent", id: "agent_dev_b", role: "billing" },
  revision: 1,
  cursor: "000001",
  occurredAt: "2026-09-26T15:00:00.000Z",
  payload: { commandId: "command_dev_b_publish_n_plus_1", dependencyRevision: 8, evidenceIds: ["evidence_pub"] },
} as unknown as EventEnvelope;

function projection(overrides: Partial<ProjectProjection> = {}): ProjectProjection {
  return {
    scope, revision: 2, eventCursor: "000001", policyEpoch: 1, runs: [], accessRequests: [],
    dependencies: [{ dependencyId: "dep", providerServiceId: "orders", consumerServiceId: "billing", revision: 8,
      artifactHash: "sha256:x", evidenceIds: ["evidence_pub"] }],
    addressedMessages: [{ messageId: "message:command_dev_b_publish_n_plus_1", senderAgentId: "agent_dev_b",
      recipientAgentId: "agent_dev_a", body: "Re-check the Orders candidate.", dependencyRevision: 8, evidenceIds: ["evidence_pub"] }],
    timeline: [{ eventId: "event:abc", cursor: "000001", type: "dependency.published",
      summary: "Dev B published dependency revision 8.", evidenceIds: ["evidence_pub"] }],
    ...overrides,
  } as ProjectProjection;
}

test("publication links Dev B to Dev A and traces everything to the stored event", () => {
  const view = viewFromRuntime({ projection: projection(), events: [published], agents });
  assert.equal(view.agents.billing.latestAction?.value, "Dev B published dependency revision 8.");
  assert.equal(view.agents.billing.latestAction?.eventId, "event:abc");
  assert.equal(view.agents.billing.state, "coordinating");
  assert.equal(view.agents.orders.affectedBy?.value, "billing");
  assert.equal(view.agents.orders.affectedBy?.eventId, "event:abc");
  assert.deepEqual(view.links.map((l) => [l.from, l.to, l.reason, l.lastEventId]),
    [["billing", "orders", "Dependency revision 8", "event:abc"]]);
  assert.equal(view.timeline[0]?.type, "dependency.published");
  assert.equal(view.lastCursor, "000001");
});

test("agents without runs or messages stay idle rather than guessed", () => {
  const view = viewFromRuntime({ projection: projection({ addressedMessages: [], timeline: [] }), events: [], agents });
  assert.equal(view.agents.orders.state, "idle");
  assert.equal(view.agents.billing.state, "idle");
  assert.equal(view.agents.pm.state, "idle");
});

test("run status drives agent state and a blocked run marks its links", () => {
  const view = viewFromRuntime({
    projection: projection({
      runs: [{ runId: "run_a", ownerAgentId: "agent_dev_a", status: "blocked", summary: "Stage the Orders candidate",
        blocker: "STALE_DEPENDENCY_REVISION", checkpointRevision: 1, evidenceIds: [] }] as unknown as ProjectProjection["runs"],
    }),
    events: [published],
    agents,
  });
  assert.equal(view.agents.orders.state, "blocked");
  assert.equal(view.agents.orders.blocker?.value, "STALE_DEPENDENCY_REVISION");
  assert.equal(view.links[0]?.blocking, true);
});

test("a missing projection renders an empty, idle view", () => {
  const view = viewFromRuntime({ projection: null, events: [], agents });
  assert.equal(view.timeline.length, 0);
  assert.equal(view.lastCursor, null);
});
