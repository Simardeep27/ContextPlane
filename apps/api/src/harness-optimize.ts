import { roleToolAllowlists, toolDefinitions, type AgentRole, type ToolName } from "@context-plane/contracts";
import { mvp02Scenario } from "@context-plane/scenario";

export type OptimizationLevel = "low" | "medium" | "high";

export interface HarnessOptimizeInput {
  readonly prompt: string;
  readonly optimizationLevel: OptimizationLevel;
}

const highValueToolDescriptions: Partial<Record<ToolName, string>> = {
  get_project_context: "Read the current authorized project state and dependency revision before acting.",
  report_progress: "Report a concise progress update with evidence references.",
  send_agent_message: "Send the affected service owner a bounded message about this versioned change.",
  propose_change: "Propose the service change with its candidate hash and current dependency and policy versions.",
  check_change: "Verify the candidate against the current dependency revision and policy epoch.",
  acknowledge_change: "Record the consumer's patch or verified no-change result for this candidate.",
  stage_change: "Stage the exact candidate and artifact hashes through the registered runner.",
  run_checks: "Run only registered checks against the exact staged candidate.",
  apply_change: "Publish only the exact candidate that passed registered checks and version checks.",
  read_operation: "Reconcile a prior side effect using its stable operation key.",
};

const highOptimizationTools: Readonly<Record<AgentRole, readonly ToolName[]>> = {
  pm: ["get_project_context", "request_status", "send_agent_message", "read_operation"],
  orders: ["get_project_context", "report_progress", "send_agent_message", "propose_change",
    "check_change", "stage_change", "run_checks", "apply_change", "read_operation"],
  billing: ["get_project_context", "report_progress", "send_agent_message", "propose_change",
    "acknowledge_change", "stage_change", "run_checks", "read_operation"],
  notifications: ["get_project_context", "report_progress", "send_agent_message", "propose_change",
    "acknowledge_change", "stage_change", "run_checks", "read_operation"],
};

export function optimizeHarnessPrompt(input: HarnessOptimizeInput) {
  const role: AgentRole = "orders";
  const baseline = mvp02Scenario.dependencyRevisions[0];
  if (!baseline) throw new Error("SCENARIO_INVALID");

  const selectedTools = input.optimizationLevel === "high"
    ? highOptimizationTools[role]
    : roleToolAllowlists[role];
  const tools = selectedTools.map(name => {
    const definition = toolDefinitions[name];
    return {
      ...definition,
      ...(input.optimizationLevel === "high" && highValueToolDescriptions[name]
        ? { description: highValueToolDescriptions[name] }
        : {}),
    };
  });

  const optimizedPrompt = {
    scenarioId: mvp02Scenario.scenarioId,
    role,
    task: mvp02Scenario.staleCandidate.summary,
    request: input.prompt,
    context: {
      orgId: mvp02Scenario.scope.orgId,
      projectId: mvp02Scenario.scope.projectId,
      dependencyId: mvp02Scenario.dependency.dependencyId,
      providerService: mvp02Scenario.dependency.providerServiceId,
      consumerService: mvp02Scenario.dependency.consumerServiceId,
      dependencyRevision: baseline.revision,
      policyEpoch: mvp02Scenario.policyEpoch,
    },
    instructions: [
      "Inspect the current project context and use its dependency revision and policy epoch.",
      "The Orders API currently expresses monetary values in cents; coordinate a unit change with Billing.",
      "Use addressed messages for cross-service coordination and include evidence references in progress reports.",
      "Stage the exact candidate, run registered checks, and apply only after the checks pass.",
    ],
    tools,
  };

  return {
    status: "completed" as const,
    optimizationLevel: input.optimizationLevel,
    processing: {
      status: "completed" as const,
      optimizationLevel: input.optimizationLevel,
      message: `Prompt processing completed at ${input.optimizationLevel} optimization.`,
      steps: ["Analyzed the request", "Selected scenario context", "Prepared the optimized prompt"],
    },
    optimizedPrompt,
  };
}

export function parseHarnessOptimizeInput(value: unknown): HarnessOptimizeInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("INVALID_INPUT");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.prompt !== "string" || record.prompt.trim().length === 0 || record.prompt.length > 12_000) {
    throw new TypeError("INVALID_INPUT");
  }
  if (record.optimizationLevel !== "low" && record.optimizationLevel !== "medium" && record.optimizationLevel !== "high") {
    throw new TypeError("INVALID_INPUT");
  }
  return { prompt: record.prompt.trim(), optimizationLevel: record.optimizationLevel };
}
