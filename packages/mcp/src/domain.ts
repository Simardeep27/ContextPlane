import { Ajv } from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, type OperationKey, type PersistenceAdapter, type ProjectScope } from '@context-plane/contracts';
import { PersistenceError } from '@context-plane/persistence';
import { CoordinationError, type CoordinationRepository, type CoordinationToolName } from './coordination.js';

export const coordinationTools = ['register_agent', 'register_dependency', 'get_context', 'publish_surface',
  'send_message', 'receive_inbox', 'acknowledge'] as const satisfies readonly CoordinationToolName[];
export const readTools = ['get_project_context', 'read_operation'] as const;
export const implementedTools = [...readTools, ...coordinationTools] as const;
export type ImplementedToolName = (typeof implementedTools)[number];
export interface Principal {
  readonly scope: ProjectScope;
  readonly coordinationScope: string;
  readonly allowedTools: readonly ImplementedToolName[];
  readonly identity: string;
}
export interface DomainHandler {
  readonly readOnly: boolean;
  execute(principal: Principal, args: Record<string, unknown>): Promise<unknown>;
}
export type DomainHandlers = Partial<Record<ImplementedToolName, DomainHandler>>;
type Reader = Pick<PersistenceAdapter, 'readProjection' | 'readReceipt'>;

/** Read adapters only. Simar's handlers can be injected without renaming tools. */
export function readHandlers(repository: () => Promise<Reader>): DomainHandlers {
  return {
    get_project_context: { readOnly: true, execute: async principal => ({
      mode: 'shared-project-read-only', scope: principal.scope,
      projection: await (await repository()).readProjection(principal.scope),
      implementedTools: readTools,
      runtimeStatus: 'Product check/apply handlers are not integrated into MCP; coordination writes are separate.',
    }) },
    read_operation: { readOnly: true, execute: async (principal, args) => ({
      scope: principal.scope,
      receipt: await (await repository()).readReceipt(principal.scope, args.operationKey as OperationKey),
    }) },
  };
}

const identifier = { type: 'string', minLength: 1, maxLength: 256 } as const;
const evidenceIds = { type: 'array', maxItems: 100, items: identifier } as const;
const coordinationDefinitions: Readonly<Record<CoordinationToolName, Tool>> = {
  register_agent: {
    name: 'register_agent', description: 'Register one stable agent identity in the configured project scope.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier,
        metadata: { type: 'object', maxProperties: 32, additionalProperties: true } },
      required: ['identity', 'scope'] },
  },
  register_dependency: {
    name: 'register_dependency', description: 'Register or revise one durable dependency between agent identities.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, dependency_id: identifier,
        depends_on: identifier, description: { type: 'string', maxLength: 2000 } },
      required: ['identity', 'scope', 'dependency_id', 'depends_on', 'description'] },
  },
  get_context: {
    name: 'get_context', description: 'Read durable coordination context for one registered agent.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier }, required: ['identity', 'scope'] },
  },
  publish_surface: {
    name: 'publish_surface', description: 'Publish or revise a named durable coordination surface.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, surface_name: identifier, kind: identifier,
        content: { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'number' },
          { type: 'boolean' }, { type: 'null' }] } },
      required: ['identity', 'scope', 'surface_name', 'kind', 'content'] },
  },
  send_message: {
    name: 'send_message', description: 'Send an idempotent durable message to one registered agent identity.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, message_id: identifier, recipient: identifier,
        body: { type: 'string', minLength: 1, maxLength: 8000 }, evidence_ids: evidenceIds },
      required: ['identity', 'scope', 'message_id', 'recipient', 'body'] },
  },
  receive_inbox: {
    name: 'receive_inbox', description: 'Lease retryable inbox messages addressed to one registered agent.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier,
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        lease_seconds: { type: 'integer', minimum: 10, maximum: 3600 } },
      required: ['identity', 'scope'] },
  },
  acknowledge: {
    name: 'acknowledge', description: 'Acknowledge a leased inbox item or return it to the retryable queue.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, message_id: identifier,
        lease_generation: { type: 'integer', minimum: 1 }, success: { type: 'boolean' } },
      required: ['identity', 'scope', 'message_id', 'lease_generation', 'success'] },
  },
};

function requireCoordinationScope(principal: Principal, args: Record<string, unknown>): string {
  if (args.scope !== principal.coordinationScope) throw new CoordinationError('INVALID_INPUT');
  return args.scope as string;
}

async function requireRegistered(repository: CoordinationRepository, identity: string, scope: string): Promise<void> {
  if (!await repository.getContext(identity, scope)) throw new CoordinationError('NOT_FOUND');
}

export function coordinationHandlers(repository: () => Promise<CoordinationRepository>): DomainHandlers {
  return {
    register_agent: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args);
      return (await repository()).registerAgent({ identity: args.identity as string, coordinationScope: scope,
        metadata: (args.metadata ?? {}) as Readonly<Record<string, unknown>> });
    } },
    register_dependency: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return repo.registerDependency({ dependencyId: args.dependency_id as string, coordinationScope: scope,
        ownerIdentity: args.identity as string, dependsOn: args.depends_on as string,
        description: args.description as string });
    } },
    get_context: { readOnly: true, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args);
      return { projectScope: principal.scope, coordinationScope: scope,
        context: await (await repository()).getContext(args.identity as string, scope) };
    } },
    publish_surface: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return repo.publishSurface({ surfaceName: args.surface_name as string, coordinationScope: scope,
        ownerIdentity: args.identity as string, kind: args.kind as string, content: args.content });
    } },
    send_message: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      await requireRegistered(repo, args.recipient as string, scope);
      return repo.sendMessage({ messageId: args.message_id as string, coordinationScope: scope,
        senderIdentity: args.identity as string, recipientIdentity: args.recipient as string,
        body: args.body as string, evidenceIds: (args.evidence_ids ?? []) as string[] });
    } },
    receive_inbox: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return { messages: await repo.receiveInbox(args.identity as string, scope,
        (args.limit ?? 10) as number, (args.lease_seconds ?? 300) as number) };
    } },
    acknowledge: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return repo.acknowledge(args.identity as string, scope, args.message_id as string,
        args.lease_generation as number, args.success as boolean);
    } },
  };
}

const validator = new Ajv({ strict: true, allErrors: false });
const definitions = new Map<string, Tool>([
  ...Object.entries(toolDefinitions).map(([name, definition]) => [name, {
    ...definition, inputSchema: definition.inputSchema as Tool['inputSchema'],
  }] as const),
  ...Object.entries(coordinationDefinitions),
]);
const schemas = new Map([...definitions].map(([name, definition]) => [name, validator.compile(definition.inputSchema)]));
function errorResult(code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: code }] };
}
export function createDomainServer(principal: Principal, handlers: DomainHandlers): Server {
  const identity = structuredClone(principal);
  const available = identity.allowedTools.filter(name => handlers[name] !== undefined);
  const server = new Server({ name: 'context-plane', version: '1.0.0' }, { capabilities: { tools: {} },
    instructions: 'Coordinate durable project context and read product evidence. Never publish credentials, hidden reasoning, or invented progress.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: available.map(name => ({
    ...definitions.get(name)!,
    annotations: { readOnlyHint: handlers[name]!.readOnly, destructiveHint: !handlers[name]!.readOnly,
      idempotentHint: handlers[name]!.readOnly, openWorldHint: false },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name as ImplementedToolName;
    if (!available.includes(name)) return errorResult('TOOL_UNAVAILABLE');
    const args = request.params.arguments ?? {};
    if (Buffer.byteLength(JSON.stringify(args)) > 32_768 || !schemas.get(name)?.(args)) return errorResult('INVALID_INPUT');
    try {
      const output = await handlers[name]!.execute(identity, args);
      const text = JSON.stringify(output);
      if (!text || Buffer.byteLength(text) > 131_072) return errorResult('CONTEXT_BUDGET_EXCEEDED');
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return errorResult(error instanceof PersistenceError || error instanceof CoordinationError
        ? error.code : 'SERVICE_UNAVAILABLE');
    }
  });
  return server;
}
