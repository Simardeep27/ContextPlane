import type { AddressedMessage, AgentId, EvidenceId, ProjectScope } from "./contracts.js";

export const toolNames = [
  "get_project_context",
  "request_status",
  "report_progress",
  "send_agent_message",
  "request_access",
  "check_access",
  "query_demo_orders",
  "propose_change",
  "check_change",
  "acknowledge_change",
  "stage_change",
  "run_checks",
  "apply_change",
  "read_operation",
] as const;

export type ToolName = (typeof toolNames)[number];
export type AgentRole = "pm" | "orders" | "billing" | "notifications";

export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface AgentContextPacket {
  readonly scope: ProjectScope;
  readonly role: AgentRole;
  readonly agentId: AgentId;
  readonly task: string;
  readonly dependencyRevision: number;
  readonly addressedMessages: readonly AddressedMessage[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly allowedTools: readonly ToolName[];
  readonly policyEpoch: number;
}

const stringValue = { type: "string", minLength: 1 } as const;
const integerValue = { type: "integer", minimum: 0 } as const;
const stringArray = { type: "array", items: stringValue } as const;

function defineTool(
  name: ToolName,
  description: string,
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

export const toolDefinitions = {
  get_project_context: defineTool(
    "get_project_context",
    "Read the authorized project projection for the current agent.",
    {},
  ),
  request_status: defineTool(
    "request_status",
    "Request evidence-backed status from an addressed agent.",
    { recipientAgentId: stringValue, question: stringValue },
    ["recipientAgentId", "question"],
  ),
  report_progress: defineTool(
    "report_progress",
    "Report progress with evidence references.",
    { summary: stringValue, evidenceIds: stringArray },
    ["summary", "evidenceIds"],
  ),
  send_agent_message: defineTool(
    "send_agent_message",
    "Send a bounded, addressed project message.",
    { recipientAgentId: stringValue, body: stringValue, evidenceIds: stringArray },
    ["recipientAgentId", "body", "evidenceIds"],
  ),
  request_access: defineTool(
    "request_access",
    "Request scoped, expiring access from its human owner.",
    {
      resource: stringValue,
      action: stringValue,
      purpose: stringValue,
      durationSeconds: integerValue,
    },
    ["resource", "action", "purpose", "durationSeconds"],
  ),
  check_access: defineTool(
    "check_access",
    "Check the effective state of an existing access request.",
    { accessRequestId: stringValue },
    ["accessRequestId"],
  ),
  query_demo_orders: defineTool(
    "query_demo_orders",
    "Execute the protected synthetic Orders read.",
    { accessRequestId: stringValue, queryName: stringValue },
    ["accessRequestId", "queryName"],
  ),
  propose_change: defineTool(
    "propose_change",
    "Propose a versioned synthetic service change.",
    {
      candidateHash: stringValue,
      dependencyRevision: integerValue,
      policyEpoch: integerValue,
      summary: stringValue,
    },
    ["candidateHash", "dependencyRevision", "policyEpoch", "summary"],
  ),
  check_change: defineTool(
    "check_change",
    "Check a candidate against dependency and policy versions.",
    {
      candidateHash: stringValue,
      dependencyRevision: integerValue,
      policyEpoch: integerValue,
    },
    ["candidateHash", "dependencyRevision", "policyEpoch"],
  ),
  acknowledge_change: defineTool(
    "acknowledge_change",
    "Acknowledge a versioned change with a patch or verified no-change result.",
    { candidateHash: stringValue, acknowledgement: stringValue, evidenceIds: stringArray },
    ["candidateHash", "acknowledgement", "evidenceIds"],
  ),
  stage_change: defineTool(
    "stage_change",
    "Stage an exact candidate through the isolated registered runner.",
    { candidateHash: stringValue, artifactHashes: stringArray },
    ["candidateHash", "artifactHashes"],
  ),
  run_checks: defineTool(
    "run_checks",
    "Run server-registered checks against an exact staged candidate.",
    { candidateHash: stringValue, registeredCommands: stringArray },
    ["candidateHash", "registeredCommands"],
  ),
  apply_change: defineTool(
    "apply_change",
    "Publish only the exact candidate that passed registered checks.",
    {
      candidateHash: stringValue,
      dependencyRevision: integerValue,
      policyEpoch: integerValue,
      operationKey: stringValue,
    },
    ["candidateHash", "dependencyRevision", "policyEpoch", "operationKey"],
  ),
  read_operation: defineTool(
    "read_operation",
    "Reconcile a side effect by its stable operation key.",
    { operationKey: stringValue },
    ["operationKey"],
  ),
} as const satisfies Readonly<Record<ToolName, ToolDefinition>>;

export const roleToolAllowlists: Readonly<Record<AgentRole, readonly ToolName[]>> = {
  pm: ["get_project_context", "request_status", "send_agent_message", "read_operation"],
  orders: [
    "get_project_context",
    "report_progress",
    "send_agent_message",
    "request_access",
    "check_access",
    "query_demo_orders",
    "propose_change",
    "check_change",
    "stage_change",
    "run_checks",
    "apply_change",
    "read_operation",
  ],
  billing: [
    "get_project_context",
    "report_progress",
    "send_agent_message",
    "propose_change",
    "acknowledge_change",
    "stage_change",
    "run_checks",
    "read_operation",
  ],
  notifications: [
    "get_project_context",
    "report_progress",
    "send_agent_message",
    "propose_change",
    "acknowledge_change",
    "stage_change",
    "run_checks",
    "read_operation",
  ],
};
