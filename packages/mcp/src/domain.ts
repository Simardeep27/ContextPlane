import { Ajv } from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, type OperationKey, type PersistenceAdapter, type ProjectScope, type ToolName } from '@context-plane/contracts';
import { PersistenceError } from '@context-plane/persistence';

export const implementedTools = ['get_project_context', 'read_operation'] as const;
export interface Principal {
  readonly scope: ProjectScope;
  readonly allowedTools: readonly ToolName[];
  readonly identity: string;
}
export interface DomainHandler {
  readonly readOnly: boolean;
  execute(principal: Principal, args: Record<string, unknown>): Promise<unknown>;
}
export type DomainHandlers = Partial<Record<ToolName, DomainHandler>>;
type Reader = Pick<PersistenceAdapter, 'readProjection' | 'readReceipt'>;

/** Read adapters only. Simar's handlers can be injected without renaming tools. */
export function readHandlers(repository: () => Promise<Reader>): DomainHandlers {
  return {
    get_project_context: { readOnly: true, execute: async principal => ({
      mode: 'shared-project-read-only', scope: principal.scope,
      projection: await (await repository()).readProjection(principal.scope),
      implementedTools,
      runtimeStatus: 'Domain write handlers are not integrated in this deployment.',
    }) },
    read_operation: { readOnly: true, execute: async (principal, args) => ({
      scope: principal.scope,
      receipt: await (await repository()).readReceipt(principal.scope, args.operationKey as OperationKey),
    }) },
  };
}

const validator = new Ajv({ strict: true, allErrors: false });
const schemas = new Map(Object.entries(toolDefinitions).map(([name, definition]) => [name, validator.compile(definition.inputSchema)]));
function errorResult(code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: code }] };
}
export function createDomainServer(principal: Principal, handlers: DomainHandlers): Server {
  const identity = structuredClone(principal);
  const available = identity.allowedTools.filter(name => handlers[name] !== undefined);
  const server = new Server({ name: 'context-plane', version: '1.0.0' }, { capabilities: { tools: {} },
    instructions: 'Read current ContextPlane evidence. Null means no record exists; never invent progress. This deployment does not execute or observe local shell work.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: available.map(name => ({
    ...toolDefinitions[name], inputSchema: toolDefinitions[name].inputSchema as Tool['inputSchema'],
    annotations: { readOnlyHint: handlers[name]!.readOnly, destructiveHint: !handlers[name]!.readOnly,
      idempotentHint: handlers[name]!.readOnly, openWorldHint: false },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name as ToolName;
    if (!available.includes(name)) return errorResult('TOOL_UNAVAILABLE');
    const args = request.params.arguments ?? {};
    if (Buffer.byteLength(JSON.stringify(args)) > 32_768 || !schemas.get(name)?.(args)) return errorResult('INVALID_INPUT');
    try {
      const output = await handlers[name]!.execute(identity, args);
      const text = JSON.stringify(output);
      if (!text || Buffer.byteLength(text) > 131_072) return errorResult('CONTEXT_BUDGET_EXCEEDED');
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return errorResult(error instanceof PersistenceError ? error.code : 'SERVICE_UNAVAILABLE');
    }
  });
  return server;
}
