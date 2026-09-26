// Memory-only UI simulation. All work, checks and identities are fictional;
// clicking an approval advances playback and never grants real access.

import type { ActorRef, AgentKey, ProjectScope } from "../shared/events.ts";
import type { DraftEvent, EventStore } from "./store.ts";

export const scenarioAccessRequestId = "access_staging_orders_read";
export const scenarioResource = "demo.staging.orders";
export const scenarioAccessOwner = "Dana (Data Platform)";

type Step = { after: number; draft: (projectId: string) => DraftEvent };

const agent = (role: AgentKey): ActorRef => ({ kind: "agent", id: `agent_${role}`, role });
const run = (projectId: string, role: AgentKey) => `${projectId}:${role}`;
const candidate = "sha256:checkout-v2-9f3c1a";

function step<T extends DraftEvent["type"]>(
  after: number,
  role: AgentKey,
  type: T,
  payload: Extract<DraftEvent, { type: T }>["payload"],
): Step {
  return {
    after,
    draft: (projectId) => ({ type, runId: run(projectId, role), actor: agent(role), payload }) as DraftEvent,
  };
}

function expiresIn(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

const kickoff: Step[] = [
  step(0, "pm", "run.started", {
    agent: "pm",
    objective: "Coordinate the checkout API v2 rollout across Orders, Billing and Notifications",
    etaMinutes: 45,
  }),
  step(1500, "orders", "run.started", {
    agent: "orders",
    objective: "Update the checkout API to v2 (amounts become {value, currency})",
    etaMinutes: 30,
  }),
  step(1800, "orders", "tool.called", {
    agent: "orders",
    tool: "get_project_context",
    summary: "Found 2 consumers of POST /checkout: Billing invoicing, Notifications receipts",
    status: "succeeded",
    operationKey: "orders:get_project_context:1",
    evidenceIds: ["ev_consumers_checkout_api"],
  }),
  step(1800, "orders", "change.proposed", {
    agent: "orders",
    candidateHash: candidate,
    summary: "Checkout API v2: `amount` number → `{ value, currency }`",
    affected: ["billing", "notifications"],
  }),
  step(1200, "pm", "dependency.linked", {
    from: "pm",
    to: "orders",
    reason: "Tracking checkout API v2 delivery",
  }),
  step(1300, "billing", "run.started", {
    agent: "billing",
    objective: "Adopt the v2 currency contract in invoicing",
    etaMinutes: 25,
  }),
  step(900, "notifications", "run.started", {
    agent: "notifications",
    objective: "Patch receipt emails to render v2 amounts",
    etaMinutes: 15,
  }),
  step(1500, "billing", "run.blocked", {
    agent: "billing",
    reason: "Needs the v2 currency contract before invoicing can change",
    waitingOn: "orders",
  }),
  step(1200, "notifications", "tool.called", {
    agent: "notifications",
    tool: "acknowledge_change",
    summary: "Receipt template reads amount.value and formats amount.currency",
    status: "succeeded",
    operationKey: "notifications:acknowledge_change:1",
    evidenceIds: ["ev_patch_receipt_template"],
  }),
  step(1300, "orders", "tool.called", {
    agent: "orders",
    tool: "stage_change",
    summary: "Staged checkout v2 handler and contract schema",
    status: "succeeded",
    operationKey: "orders:stage_change:1",
    evidenceIds: ["ev_stage_checkout_v2"],
  }),
  step(1500, "notifications", "tool.called", {
    agent: "notifications",
    tool: "run_checks",
    summary: "Ran registered receipt rendering suite",
    status: "succeeded",
    operationKey: "notifications:run_checks:1",
    evidenceIds: [],
  }),
  step(1600, "notifications", "test.result", {
    agent: "notifications",
    suite: "receipt-rendering",
    passed: 12,
    failed: 0,
    evidenceId: "ev_ci_receipts_1842",
  }),
  step(1000, "notifications", "run.completed", {
    agent: "notifications",
    summary: "Compatibility patch for v2 amounts",
    evidenceIds: ["ev_ci_receipts_1842"],
  }),
  step(900, "notifications", "message.sent", {
    from: "notifications",
    to: "pm",
    body: "Receipt emails handle v2 amounts; 12/12 rendering tests pass.",
    evidenceIds: ["ev_ci_receipts_1842"],
  }),
  step(1300, "pm", "message.sent", {
    from: "pm",
    to: "orders",
    body: "Notifications is done. What's left before Billing can move?",
    evidenceIds: [],
  }),
  step(1300, "orders", "tool.called", {
    agent: "orders",
    tool: "run_checks",
    summary: "Integration suite needs a read of staging orders",
    status: "failed",
    operationKey: "orders:run_checks:1",
    evidenceIds: ["ev_ci_checkout_denied"],
  }),
  step(1200, "orders", "run.blocked", {
    agent: "orders",
    reason: `Missing ${scenarioResource}:read access for integration tests`,
    accessRequestId: scenarioAccessRequestId,
  }),
  step(1200, "orders", "access.requested", {
    agent: "orders",
    accessRequestId: scenarioAccessRequestId,
    resource: scenarioResource,
    action: "read",
    purpose: "Verify checkout v2 against staging orders before publishing the contract",
    owner: scenarioAccessOwner,
    expiresAt: expiresIn(60),
  }),
  step(900, "orders", "message.sent", {
    from: "orders",
    to: "pm",
    body: "Blocked on staging orders read access; request sent to Dana (Data Platform).",
    evidenceIds: [],
  }),
];

const afterApproval: Step[] = [
  step(900, "orders", "run.resumed", {
    agent: "orders",
    note: "Access approved; resuming integration tests",
    etaMinutes: 8,
  }),
  step(1300, "orders", "tool.called", {
    agent: "orders",
    tool: "query_demo_orders",
    summary: "Read 200 synthetic staging orders under the approved grant",
    status: "succeeded",
    operationKey: "orders:query_demo_orders:1",
    evidenceIds: ["ev_protected_read_orders"],
  }),
  step(1300, "orders", "tool.called", {
    agent: "orders",
    tool: "run_checks",
    summary: "Re-ran checkout integration suite",
    status: "succeeded",
    operationKey: "orders:run_checks:2",
    evidenceIds: [],
  }),
  step(1600, "orders", "test.result", {
    agent: "orders",
    suite: "checkout-integration",
    passed: 24,
    failed: 0,
    evidenceId: "ev_ci_checkout_2210",
  }),
  step(1200, "orders", "tool.called", {
    agent: "orders",
    tool: "apply_change",
    summary: `Published ${candidate} (the exact candidate that passed checks)`,
    status: "succeeded",
    operationKey: "orders:apply_change:1",
    evidenceIds: ["ev_publish_checkout_v2"],
  }),
  step(1000, "orders", "message.sent", {
    from: "orders",
    to: "billing",
    body: "Currency contract v2 is published. Schema and fixtures attached.",
    evidenceIds: ["ev_publish_checkout_v2"],
  }),
  step(1200, "billing", "run.resumed", {
    agent: "billing",
    note: "Currency contract v2 received; updating invoice mapping",
    etaMinutes: 6,
  }),
  step(1000, "orders", "run.completed", {
    agent: "orders",
    summary: "Checkout API v2 release",
    evidenceIds: ["ev_ci_checkout_2210", "ev_publish_checkout_v2"],
  }),
  step(1300, "billing", "tool.called", {
    agent: "billing",
    tool: "run_checks",
    summary: "Ran invoicing suite against contract v2",
    status: "succeeded",
    operationKey: "billing:run_checks:1",
    evidenceIds: [],
  }),
  step(1600, "billing", "test.result", {
    agent: "billing",
    suite: "invoicing",
    passed: 31,
    failed: 0,
    evidenceId: "ev_ci_invoicing_0577",
  }),
  step(1000, "billing", "run.completed", {
    agent: "billing",
    summary: "Invoicing migration to currency contract v2",
    evidenceIds: ["ev_ci_invoicing_0577"],
  }),
  step(900, "billing", "message.sent", {
    from: "billing",
    to: "pm",
    body: "Invoicing is on v2; 31/31 tests pass.",
    evidenceIds: ["ev_ci_invoicing_0577"],
  }),
  step(1200, "pm", "run.completed", {
    agent: "pm",
    summary: "Checkout API v2 rollout, verified by all three teams",
    evidenceIds: ["ev_ci_checkout_2210", "ev_ci_invoicing_0577", "ev_ci_receipts_1842"],
  }),
];

const afterDenial: Step[] = [
  step(900, "orders", "message.sent", {
    from: "orders",
    to: "pm",
    body: "Access was denied; checkout v2 can't be verified. Holding the release.",
    evidenceIds: [],
  }),
];

export type ScenarioStatus = "idle" | "running" | "awaiting_approval" | "done";

export class ScenarioRunner {
  status: ScenarioStatus = "idle";
  private generation = 0;
  private cancelDelay: (() => void) | null = null;

  constructor(
    private readonly store: EventStore,
    private readonly pace: number,
  ) {
    if (!Number.isFinite(pace) || pace < 0) throw new Error("Invalid simulation pace");
  }

  stop() {
    this.generation++;
    this.cancelDelay?.();
    this.cancelDelay = null;
  }

  async start(scope: ProjectScope) {
    this.stop();
    const generation = ++this.generation;
    this.status = "running";
    const finished = await this.play(scope, kickoff, generation);
    if (finished) this.status = "awaiting_approval";
  }

  async continueAfterDecision(scope: ProjectScope, decision: "approved" | "denied") {
    this.stop();
    const generation = ++this.generation;
    this.status = "running";
    const finished = await this.play(scope, decision === "approved" ? afterApproval : afterDenial, generation);
    if (finished) this.status = "done";
  }

  // A newer start() supersedes any playback still in flight.
  private async play(scope: ProjectScope, steps: Step[], generation: number) {
    for (const { after, draft } of steps) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, after * this.pace);
        this.cancelDelay = () => { clearTimeout(timer); resolve(); };
      });
      this.cancelDelay = null;
      if (generation !== this.generation) return false;
      await this.store.append(scope, draft(scope.projectId));
    }
    return true;
  }
}
