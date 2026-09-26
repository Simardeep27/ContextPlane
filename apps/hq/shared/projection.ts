// Folds the event history into the view HQ renders. Every field shown in the
// UI is derived here from recorded events, and keeps the eventId it came from
// so the manager can trace any claim back to the history.

import {
  agentKeys,
  agentProfiles,
  type AgentKey,
  type HQEvent,
} from "./events.ts";

export type AgentState =
  | "idle"
  | "investigating"
  | "coding"
  | "waiting_approval"
  | "blocked"
  | "testing"
  | "coordinating"
  | "complete";

export const stateLabels: Readonly<Record<AgentState, string>> = {
  idle: "Idle",
  investigating: "Investigating",
  coding: "Coding",
  waiting_approval: "Waiting for approval",
  blocked: "Blocked",
  testing: "Testing",
  coordinating: "Coordinating",
  complete: "Complete",
};

export interface Traced<T> {
  readonly value: T;
  readonly eventId: string;
  readonly at: string;
}

export interface EvidenceItem {
  readonly id: string;
  readonly label: string;
  readonly kind: "tool" | "test" | "message" | "approval" | "result";
  readonly eventId: string;
  readonly at: string;
}

export interface MessageItem {
  readonly eventId: string;
  readonly from: AgentKey;
  readonly to: AgentKey;
  readonly body: string;
  readonly at: string;
}

export interface AgentView {
  readonly key: AgentKey;
  // Person/agent label from the data source; falls back to the HQ profile.
  employee: string | null;
  state: AgentState;
  stateSince: Traced<AgentState> | null;
  runId: string | null;
  objective: Traced<string> | null;
  latestAction: Traced<string> | null;
  blocker: Traced<string> | null;
  waitingOn: AgentKey | null;
  eta: Traced<string> | null;
  evidence: EvidenceItem[];
  messages: MessageItem[];
  // Set when a proposed change names this agent as affected.
  affectedBy: Traced<AgentKey> | null;
}

export interface LinkView {
  readonly from: AgentKey;
  readonly to: AgentKey;
  reason: string;
  blocking: boolean;
  lastActivityAt: string;
  lastEventId: string;
}

export interface AccessRequestView {
  readonly accessRequestId: string;
  readonly agent: AgentKey;
  readonly resource: string;
  readonly action: string;
  readonly purpose: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly requestedEventId: string;
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  decidedEventId: string | null;
}

export interface TimelineItem {
  readonly eventId: string;
  readonly revision: number;
  // Scripted HQ types or open-ended runtime event types.
  readonly type: string;
  readonly at: string;
  readonly agents: readonly AgentKey[];
  readonly actor: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
}

export interface HQView {
  agents: Record<AgentKey, AgentView>;
  links: LinkView[];
  accessRequests: AccessRequestView[];
  timeline: TimelineItem[];
  lastCursor: string | null;
  lastEventAt: string | null;
}

export function emptyView(): HQView {
  const agents = {} as Record<AgentKey, AgentView>;
  for (const key of agentKeys) {
    agents[key] = {
      key,
      employee: null,
      state: "idle",
      stateSince: null,
      runId: null,
      objective: null,
      latestAction: null,
      blocker: null,
      waitingOn: null,
      eta: null,
      evidence: [],
      messages: [],
      affectedBy: null,
    };
  }
  return { agents, links: [], accessRequests: [], timeline: [], lastCursor: null, lastEventAt: null };
}

const name = (key: AgentKey) => agentProfiles[key].name;

export function describeEvent(event: HQEvent): string {
  switch (event.type) {
    case "run.started":
      return `${name(event.payload.agent)} started: ${event.payload.objective}`;
    case "run.blocked":
      return `${name(event.payload.agent)} blocked: ${event.payload.reason}`;
    case "run.resumed":
      return `${name(event.payload.agent)} resumed: ${event.payload.note}`;
    case "run.completed":
      return `${name(event.payload.agent)} completed: ${event.payload.summary}`;
    case "change.proposed":
      return `${name(event.payload.agent)} proposed ${event.payload.candidateHash}: ${event.payload.summary}`;
    case "dependency.linked":
      return `${name(event.payload.from)} → ${name(event.payload.to)}: ${event.payload.reason}`;
    case "tool.called":
      return `${name(event.payload.agent)} ${event.payload.tool} (${event.payload.status}): ${event.payload.summary}`;
    case "test.result":
      return `${name(event.payload.agent)} ${event.payload.suite}: ${event.payload.passed} passed, ${event.payload.failed} failed`;
    case "message.sent":
      return `${name(event.payload.from)} → ${name(event.payload.to)}: “${event.payload.body}”`;
    case "access.requested":
      return `${name(event.payload.agent)} requested ${event.payload.action} on ${event.payload.resource} from ${event.payload.owner}`;
    case "access.decided":
      return `${event.payload.decidedBy} ${event.payload.decision} ${event.payload.accessRequestId}`;
  }
}

function agentsOf(event: HQEvent, view: HQView): AgentKey[] {
  switch (event.type) {
    case "change.proposed":
      return [event.payload.agent, ...event.payload.affected];
    case "dependency.linked":
    case "message.sent":
      return [event.payload.from, event.payload.to];
    case "access.decided": {
      const request = view.accessRequests.find((r) => r.accessRequestId === event.payload.accessRequestId);
      return request ? [request.agent] : [];
    }
    default:
      return [event.payload.agent];
  }
}

function evidenceIdsOf(event: HQEvent): string[] {
  switch (event.type) {
    case "run.completed":
    case "tool.called":
    case "message.sent":
      return event.payload.evidenceIds;
    case "test.result":
      return [event.payload.evidenceId];
    default:
      return [];
  }
}

// Once an agent is held up, only a resume/complete/decision moves it on; its
// own housekeeping tool calls or messages must not make it look busy again.
const heldStates: readonly AgentState[] = ["blocked", "waiting_approval", "complete"];

function stateForTool(tool: string): AgentState {
  if (tool === "run_checks") return "testing";
  if (tool === "send_agent_message" || tool === "request_status") return "coordinating";
  if (tool === "get_project_context" || tool.startsWith("query_") || tool === "check_access") return "investigating";
  return "coding";
}

function upsertLink(view: HQView, from: AgentKey, to: AgentKey, reason: string, event: HQEvent): LinkView {
  let link = view.links.find((l) => l.from === from && l.to === to);
  if (!link) {
    link = { from, to, reason, blocking: false, lastActivityAt: event.occurredAt, lastEventId: event.eventId };
    view.links.push(link);
  }
  link.reason = reason;
  link.lastActivityAt = event.occurredAt;
  link.lastEventId = event.eventId;
  return link;
}

export function applyEvent(view: HQView, event: HQEvent): HQView {
  const trace = <T>(value: T): Traced<T> => ({ value, eventId: event.eventId, at: event.occurredAt });
  const setState = (agent: AgentView, state: AgentState, force = false) => {
    if (!force && heldStates.includes(agent.state)) return;
    if (agent.state !== state || !agent.stateSince) agent.stateSince = trace(state);
    agent.state = state;
  };
  const summary = describeEvent(event);

  switch (event.type) {
    case "run.started": {
      const agent = view.agents[event.payload.agent];
      agent.runId = event.runId;
      agent.objective = trace(event.payload.objective);
      agent.eta = trace(addMinutes(event.occurredAt, event.payload.etaMinutes));
      agent.blocker = null;
      agent.waitingOn = null;
      setState(agent, "investigating", true);
      break;
    }
    case "run.blocked": {
      const agent = view.agents[event.payload.agent];
      agent.blocker = trace(event.payload.reason);
      agent.waitingOn = event.payload.waitingOn ?? null;
      setState(agent, "blocked", true);
      if (event.payload.waitingOn) {
        upsertLink(view, event.payload.agent, event.payload.waitingOn, event.payload.reason, event).blocking = true;
      }
      break;
    }
    case "run.resumed": {
      const agent = view.agents[event.payload.agent];
      agent.blocker = null;
      agent.waitingOn = null;
      if (event.payload.etaMinutes !== undefined) {
        agent.eta = trace(addMinutes(event.occurredAt, event.payload.etaMinutes));
      }
      for (const link of view.links) if (link.from === agent.key) link.blocking = false;
      setState(agent, "coding", true);
      break;
    }
    case "run.completed": {
      const agent = view.agents[event.payload.agent];
      agent.blocker = null;
      agent.waitingOn = null;
      agent.eta = null;
      for (const id of event.payload.evidenceIds) {
        agent.evidence.push({ id, label: event.payload.summary, kind: "result", eventId: event.eventId, at: event.occurredAt });
      }
      setState(agent, "complete", true);
      break;
    }
    case "change.proposed": {
      const agent = view.agents[event.payload.agent];
      setState(agent, "coding");
      for (const affected of event.payload.affected) {
        view.agents[affected].affectedBy = trace(event.payload.agent);
        upsertLink(view, event.payload.agent, affected, `Affected by ${event.payload.candidateHash}`, event);
      }
      break;
    }
    case "dependency.linked":
      upsertLink(view, event.payload.from, event.payload.to, event.payload.reason, event);
      break;
    case "tool.called": {
      const agent = view.agents[event.payload.agent];
      setState(agent, stateForTool(event.payload.tool));
      const ids = event.payload.evidenceIds.length > 0 ? event.payload.evidenceIds : [event.payload.operationKey];
      for (const id of ids) {
        agent.evidence.push({
          id,
          label: `${event.payload.tool}: ${event.payload.summary}`,
          kind: "tool",
          eventId: event.eventId,
          at: event.occurredAt,
        });
      }
      break;
    }
    case "test.result": {
      const agent = view.agents[event.payload.agent];
      setState(agent, "testing");
      agent.evidence.push({
        id: event.payload.evidenceId,
        label: `${event.payload.suite}: ${event.payload.passed} passed, ${event.payload.failed} failed`,
        kind: "test",
        eventId: event.eventId,
        at: event.occurredAt,
      });
      break;
    }
    case "message.sent": {
      const message: MessageItem = {
        eventId: event.eventId,
        from: event.payload.from,
        to: event.payload.to,
        body: event.payload.body,
        at: event.occurredAt,
      };
      view.agents[event.payload.from].messages.push(message);
      if (event.payload.to !== event.payload.from) view.agents[event.payload.to].messages.push(message);
      setState(view.agents[event.payload.from], "coordinating");
      upsertLink(view, event.payload.from, event.payload.to, "Message", event);
      break;
    }
    case "access.requested": {
      const agent = view.agents[event.payload.agent];
      view.accessRequests.push({
        accessRequestId: event.payload.accessRequestId,
        agent: event.payload.agent,
        resource: event.payload.resource,
        action: event.payload.action,
        purpose: event.payload.purpose,
        owner: event.payload.owner,
        expiresAt: event.payload.expiresAt,
        requestedEventId: event.eventId,
        status: "pending",
        decidedBy: null,
        decidedEventId: null,
      });
      agent.blocker = trace(
        `Needs ${event.payload.action} on ${event.payload.resource}; awaiting approval from ${event.payload.owner}`,
      );
      setState(agent, "waiting_approval", true);
      break;
    }
    case "access.decided": {
      const request = view.accessRequests.find((r) => r.accessRequestId === event.payload.accessRequestId);
      if (!request) break;
      request.status = event.payload.decision;
      request.decidedBy = event.payload.decidedBy;
      request.decidedEventId = event.eventId;
      const agent = view.agents[request.agent];
      agent.evidence.push({
        id: event.payload.accessRequestId,
        label: `Access ${event.payload.decision} by ${event.payload.decidedBy}: ${request.action} on ${request.resource}`,
        kind: "approval",
        eventId: event.eventId,
        at: event.occurredAt,
      });
      if (event.payload.decision === "denied") {
        agent.blocker = trace(`Access to ${request.resource} denied by ${event.payload.decidedBy}`);
        setState(agent, "blocked", true);
      }
      break;
    }
  }

  const involved = agentsOf(event, view);
  const actorAgent = involved[0];
  if (actorAgent) view.agents[actorAgent].latestAction = trace(summary);

  view.timeline.push({
    eventId: event.eventId,
    revision: event.revision,
    type: event.type,
    at: event.occurredAt,
    agents: involved,
    actor: event.actor.kind === "human" ? `${event.actor.id} (human)` : event.actor.id,
    summary,
    evidenceIds: evidenceIdsOf(event),
  });
  view.lastCursor = event.cursor;
  view.lastEventAt = event.occurredAt;
  return view;
}

export function project(events: readonly HQEvent[]): HQView {
  const ordered = [...events].sort((a, b) => a.revision - b.revision);
  return ordered.reduce(applyEvent, emptyView());
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
