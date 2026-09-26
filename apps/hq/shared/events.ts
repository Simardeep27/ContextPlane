// Local presentation types for fictional playback. Runtime data uses the shared
// contracts through shared/runtime.ts; these are not a second database schema.

export type AgentKey = "pm" | "orders" | "billing" | "notifications";

export interface ProjectScope {
  readonly orgId: string;
  readonly projectId: string;
}

export interface ActorRef {
  readonly kind: "human" | "agent" | "system";
  readonly id: string;
  readonly role: AgentKey | "system";
}

export interface EventEnvelope<Type extends string = string, Payload = unknown> {
  readonly eventId: string;
  readonly type: Type;
  readonly scope: ProjectScope;
  readonly runId: string;
  readonly actor: ActorRef;
  readonly revision: number;
  readonly cursor: string;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export interface PayloadByType {
  "run.started": { agent: AgentKey; objective: string; etaMinutes: number };
  "run.blocked": {
    agent: AgentKey;
    reason: string;
    waitingOn?: AgentKey;
    accessRequestId?: string;
  };
  "run.resumed": { agent: AgentKey; note: string; etaMinutes?: number };
  "run.completed": { agent: AgentKey; summary: string; evidenceIds: string[] };
  "change.proposed": {
    agent: AgentKey;
    candidateHash: string;
    summary: string;
    affected: AgentKey[];
  };
  "dependency.linked": { from: AgentKey; to: AgentKey; reason: string };
  "tool.called": {
    agent: AgentKey;
    tool: string;
    summary: string;
    status: "succeeded" | "failed";
    operationKey: string;
    evidenceIds: string[];
  };
  "test.result": {
    agent: AgentKey;
    suite: string;
    passed: number;
    failed: number;
    evidenceId: string;
  };
  "message.sent": { from: AgentKey; to: AgentKey; body: string; evidenceIds: string[] };
  "access.requested": {
    agent: AgentKey;
    accessRequestId: string;
    resource: string;
    action: string;
    purpose: string;
    owner: string;
    expiresAt: string;
  };
  "access.decided": {
    accessRequestId: string;
    decision: "approved" | "denied";
    decidedBy: string;
  };
}

export type HQEventType = keyof PayloadByType;

export type HQEvent = {
  [T in HQEventType]: EventEnvelope<T, PayloadByType[T]>;
}[HQEventType];

export const hqEventTypes = [
  "run.started",
  "run.blocked",
  "run.resumed",
  "run.completed",
  "change.proposed",
  "dependency.linked",
  "tool.called",
  "test.result",
  "message.sent",
  "access.requested",
  "access.decided",
] as const satisfies readonly HQEventType[];

export function isHQEvent(value: EventEnvelope): value is HQEvent {
  return (hqEventTypes as readonly string[]).includes(value.type);
}

export interface AgentProfile {
  readonly key: AgentKey;
  readonly name: string;
  readonly employee: string;
  readonly team: string;
  readonly color: string;
}

export const agentProfiles: Readonly<Record<AgentKey, AgentProfile>> = {
  pm: { key: "pm", name: "PM Agent", employee: "Priya (Product)", team: "Product", color: "#a78bfa" },
  orders: { key: "orders", name: "Orders Agent", employee: "Omar (Orders)", team: "Orders", color: "#38bdf8" },
  billing: { key: "billing", name: "Billing Agent", employee: "Bea (Billing)", team: "Billing", color: "#f472b6" },
  notifications: {
    key: "notifications",
    name: "Notifications Agent",
    employee: "Nico (Notifications)",
    team: "Notifications",
    color: "#34d399",
  },
};

export const agentKeys = Object.keys(agentProfiles) as AgentKey[];
