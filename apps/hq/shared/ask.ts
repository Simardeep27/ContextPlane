// Answers manager questions directly from the projected event history. No
// model is involved: each line is assembled from recorded events and cites
// them, so the answer can't claim anything the history doesn't show.

import { agentKeys, agentProfiles, type AgentKey } from "./events.ts";
import type { AgentState, AgentView, HQView } from "./projection.ts";

export interface AnswerLine {
  readonly agent: AgentKey;
  readonly state: AgentState;
  readonly text: string;
  readonly citations: readonly { eventId: string; at: string }[];
}

export interface Answer {
  readonly question: string;
  readonly scopeNote: string;
  readonly lines: readonly AnswerLine[];
  readonly asOfCursor: string | null;
  readonly asOfTime: string | null;
}

const agentAliases: Readonly<Record<AgentKey, readonly string[]>> = {
  pm: ["pm", "product", "priya"],
  orders: ["orders", "order", "checkout", "omar"],
  billing: ["billing", "invoice", "bea"],
  notifications: ["notifications", "notification", "email", "nico"],
};

type Filter = { note: string; keep: (agent: AgentView) => boolean };

function filterFor(question: string): Filter {
  const q = question.toLowerCase();
  const named = agentKeys.filter((key) => agentAliases[key].some((alias) => new RegExp(`\\b${alias}\\b`).test(q)));
  if (named.length > 0) {
    return { note: named.map((k) => agentProfiles[k].name).join(", "), keep: (a) => named.includes(a.key) };
  }
  if (/block|stuck|wait|approv/.test(q)) {
    return { note: "Agents that are blocked or waiting", keep: (a) => a.state === "blocked" || a.state === "waiting_approval" };
  }
  if (/done|complete|finish|shipped/.test(q)) {
    return { note: "Agents that have completed", keep: (a) => a.state === "complete" };
  }
  return { note: "All agents", keep: () => true };
}

function lineFor(agent: AgentView, view: HQView): AnswerLine {
  const name = `The ${agentProfiles[agent.key].name.replace(/ Agent$/, "")} agent`;
  const objective = agent.objective?.value ?? "its current task";
  const lastMessage = agent.messages.filter((m) => m.from === agent.key).at(-1);
  const lastTest = agent.evidence.filter((e) => e.kind === "test").at(-1);
  const pendingRequest = view.accessRequests.find((r) => r.agent === agent.key && r.status === "pending");

  let text: string;
  const cite = [agent.stateSince, agent.objective].filter((t) => t !== null).map((t) => ({ eventId: t.eventId, at: t.at }));

  switch (agent.state) {
    case "idle":
      text = `${name} has no active run.`;
      break;
    case "investigating":
      text = `${name} is investigating before ${gerund(objective)}.`;
      break;
    case "coding":
      text = `${name} is ${gerund(objective)}.`;
      break;
    case "testing":
      text = lastTest
        ? `${name} is running tests while ${gerund(objective)} (latest: ${lastTest.label}).`
        : `${name} is running tests while ${gerund(objective)}.`;
      if (lastTest) cite.push({ eventId: lastTest.eventId, at: lastTest.at });
      break;
    case "coordinating":
      text = lastMessage
        ? `${name} is coordinating with the ${agentProfiles[lastMessage.to].team} agent: “${lastMessage.body}”`
        : `${name} is coordinating with other agents.`;
      if (lastMessage) cite.push({ eventId: lastMessage.eventId, at: lastMessage.at });
      break;
    case "waiting_approval":
      text = pendingRequest
        ? `${name} is blocked until ${pendingRequest.owner} approves ${pendingRequest.action} access to ${pendingRequest.resource}.`
        : `${name} is waiting for approval.`;
      if (pendingRequest) cite.push({ eventId: pendingRequest.requestedEventId, at: agent.stateSince?.at ?? "" });
      break;
    case "blocked":
      text = agent.waitingOn
        ? `${name} is waiting on the ${agentProfiles[agent.waitingOn].team} agent: ${lowerFirst(agent.blocker?.value ?? "dependency")}.`
        : `${name} is blocked: ${lowerFirst(agent.blocker?.value ?? "unknown reason")}.`;
      if (agent.blocker) cite.push({ eventId: agent.blocker.eventId, at: agent.blocker.at });
      break;
    case "complete": {
      const result = agent.evidence.filter((e) => e.kind === "result").at(-1);
      text = `${name} has completed the ${lowerFirst(result?.label ?? objective)}.`;
      if (result) cite.push({ eventId: result.eventId, at: result.at });
      break;
    }
  }

  const unique = [...new Map(cite.map((c) => [c.eventId, c])).values()];
  return { agent: agent.key, state: agent.state, text: text.replace(/\.\.$/, "."), citations: unique };
}

export function answerQuestion(question: string, view: HQView): Answer {
  const filter = filterFor(question);
  const lines = agentKeys.map((key) => view.agents[key]).filter(filter.keep).map((agent) => lineFor(agent, view));
  return { question, scopeNote: filter.note, lines, asOfCursor: view.lastCursor, asOfTime: view.lastEventAt };
}

// Objectives are recorded as imperatives ("Update the checkout API");
// "Update" → "updating" reads naturally in a status sentence.
export function gerund(objective: string): string {
  const [verb = "", ...rest] = objective.split(" ");
  const lower = verb.toLowerCase();
  if (!/^[a-z]+$/.test(lower) || lower.endsWith("ing")) return lowerFirst(objective);
  const stem = lower.endsWith("e") && !lower.endsWith("ee") ? lower.slice(0, -1) : lower;
  return [`${stem}ing`, ...rest].join(" ");
}

function lowerFirst(text: string): string {
  return text.length > 1 && text[1] !== text[1]?.toUpperCase() ? text[0]!.toLowerCase() + text.slice(1) : text;
}
