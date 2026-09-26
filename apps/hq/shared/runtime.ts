// Builds the HQ view from the Context Plane runtime (MVP-03 API): the stored
// ProjectProjection plus its committed events. Nothing is invented here —
// agent state comes from runs, links and messages from addressed messages,
// and every displayed claim points at a stored event.

import type { EventEnvelope, ProjectProjection, RunProjection } from "@context-plane/contracts";

import type { AgentKey } from "./events.ts";
import { emptyView, type AgentState, type HQView, type Traced } from "./projection.ts";

export interface RuntimeAgent {
  readonly agentId: string;
  readonly hqKey: AgentKey;
  readonly displayName: string;
  readonly serviceId: string;
}

export interface RuntimeSnapshot {
  readonly projection: ProjectProjection | null;
  readonly events: readonly EventEnvelope[];
  readonly agents: readonly RuntimeAgent[];
}

const runStates: Readonly<Record<RunProjection["status"], AgentState>> = {
  queued: "idle",
  running: "coding",
  blocked: "blocked",
  completed: "complete",
  failed: "blocked",
};

function evidenceIdsOf(event: EventEnvelope): string[] {
  const payload = event.payload as { evidenceIds?: unknown; evidenceId?: unknown } | null;
  if (Array.isArray(payload?.evidenceIds)) return payload.evidenceIds.filter((id): id is string => typeof id === "string");
  return typeof payload?.evidenceId === "string" ? [payload.evidenceId] : [];
}

export function viewFromRuntime({ projection, events, agents }: RuntimeSnapshot): HQView {
  const view = emptyView();
  const keyOf = new Map(agents.map((a) => [a.agentId, a.hqKey]));
  const ordered = [...events].sort((a, b) => Number(a.cursor) - Number(b.cursor));
  const summaries = new Map((projection?.timeline ?? []).map((t) => [t.eventId, t.summary]));
  const byCommand = new Map<string, EventEnvelope>();
  for (const event of ordered) {
    const commandId = (event.payload as { commandId?: unknown } | null)?.commandId;
    if (typeof commandId === "string") byCommand.set(commandId, event);
  }
  const traced = <T>(value: T, event: EventEnvelope | undefined, fallbackId: string): Traced<T> => ({
    value,
    eventId: event?.eventId ?? fallbackId,
    at: event?.occurredAt ?? ordered.at(-1)?.occurredAt ?? new Date(0).toISOString(),
  });
  const projectionRef = `projection@${projection?.revision ?? 0}`;

  for (const event of ordered) {
    const actor = keyOf.get(event.actor.id);
    const summary = summaries.get(event.eventId) ?? event.type;
    const evidenceIds = evidenceIdsOf(event);
    if (actor) {
      const agent = view.agents[actor];
      agent.latestAction = traced(summary, event, event.eventId);
      for (const id of evidenceIds) {
        agent.evidence.push({ id, label: summary, kind: "result", eventId: event.eventId, at: event.occurredAt });
      }
    }
    view.timeline.push({
      eventId: event.eventId,
      revision: event.revision,
      type: event.type,
      at: event.occurredAt,
      agents: actor ? [actor] : [],
      actor: event.actor.kind === "human" ? `${event.actor.id} (human)` : event.actor.id,
      summary,
      evidenceIds,
    });
  }

  for (const message of projection?.addressedMessages ?? []) {
    const from = keyOf.get(message.senderAgentId);
    const to = keyOf.get(message.recipientAgentId);
    if (!from || !to) continue;
    const source = byCommand.get(message.messageId.replace(/^message:/, ""));
    const eventId = source?.eventId ?? projectionRef;
    const at = source?.occurredAt ?? view.timeline.at(-1)?.at ?? new Date(0).toISOString();
    const item = { eventId, from, to, body: message.body, at };
    view.agents[from].messages.push(item);
    view.agents[to].messages.push(item);
    view.agents[to].affectedBy = { value: from, eventId, at };
    for (const id of message.evidenceIds) {
      view.agents[to].evidence.push({ id, label: `Addressed message: ${message.body}`, kind: "message", eventId, at });
    }
    const link = view.links.find((l) => l.from === from && l.to === to);
    const reason = `Dependency revision ${message.dependencyRevision}`;
    if (link) Object.assign(link, { reason, lastActivityAt: at, lastEventId: eventId });
    else view.links.push({ from, to, reason, blocking: false, lastActivityAt: at, lastEventId: eventId });
  }

  for (const key of Object.keys(view.agents) as AgentKey[]) {
    const agent = view.agents[key];
    const runtimeAgent = agents.find((a) => a.hqKey === key);
    agent.employee = runtimeAgent ? runtimeAgent.displayName : "No connected runtime agent";
    const run = runtimeAgent && projection?.runs.find((r) => r.ownerAgentId === runtimeAgent.agentId);
    if (run) {
      const lastRunEvent = ordered.filter((e) => e.runId === run.runId).at(-1);
      agent.runId = run.runId;
      agent.state = runStates[run.status];
      agent.stateSince = traced(agent.state, lastRunEvent, projectionRef);
      agent.objective = traced(run.summary, lastRunEvent, projectionRef);
      agent.blocker = run.blocker ? traced(run.blocker, lastRunEvent, projectionRef) : null;
      for (const id of run.evidenceIds) {
        agent.evidence.push({ id, label: run.summary, kind: "result", eventId: lastRunEvent?.eventId ?? projectionRef,
          at: lastRunEvent?.occurredAt ?? new Date(0).toISOString() });
      }
      for (const link of view.links) if (link.to === key || link.from === key) link.blocking ||= run.status === "blocked";
    } else if (agent.messages.some((m) => m.from === key) && agent.latestAction) {
      // No run yet (MVP-06): an agent whose last recorded act was notifying
      // another agent is shown as coordinating, traced to that act.
      agent.state = "coordinating";
      agent.stateSince = { value: "coordinating", eventId: agent.latestAction.eventId, at: agent.latestAction.at };
    }
  }

  for (const request of projection?.accessRequests ?? []) {
    const agent = keyOf.get(request.requesterAgentId);
    if (!agent || (request.status !== "pending" && request.status !== "approved" && request.status !== "denied")) continue;
    view.accessRequests.push({
      accessRequestId: request.accessRequestId, agent, resource: request.resource, action: request.action,
      purpose: request.purpose, owner: request.ownerUserId, expiresAt: request.expiresAt,
      requestedEventId: projectionRef, status: request.status, decidedBy: null, decidedEventId: null,
    });
  }

  view.lastCursor = projection?.eventCursor ?? ordered.at(-1)?.cursor ?? null;
  view.lastEventAt = ordered.at(-1)?.occurredAt ?? null;
  return view;
}
