import { agentLabel, noTelemetry, traceId, type Telemetry } from './telemetry.js';
import { Ajv } from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, type OperationKey, type PersistenceAdapter, type ProjectScope } from '@context-plane/contracts';
import { PersistenceError } from '@context-plane/persistence';
import { CoordinationError, type CoordinationRepository, type CoordinationToolName } from './coordination.js';
import { brainDigest, brainKinds, BRAIN_BODY_MAX_BYTES, type BrainKind, type BrainRepository } from './brain.js';
import { workFromMessage, workFromSurface, type OverlapService } from './overlap.js';

export const coordinationTools = ['register_agent', 'register_dependency', 'get_context', 'publish_surface',
  'send_message', 'receive_inbox', 'acknowledge', 'read_ledger'] as const satisfies readonly CoordinationToolName[];
export const readTools = ['get_project_context', 'read_operation'] as const;
export const brainTools = ['remember', 'recall'] as const;
export type BrainToolName = (typeof brainTools)[number];
export const overlapTools = ['check_overlap'] as const;
export type OverlapToolName = (typeof overlapTools)[number];
export const implementedTools = [...readTools, ...coordinationTools, ...brainTools, ...overlapTools] as const;
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
    name: 'get_context', description: 'Read durable coordination context for one registered agent, plus the company brain digest (active principles and the 5 most recent insights) when available.',
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
  read_ledger: {
    name: 'read_ledger', description: 'Read recent coordination reports for the scope as a sanitized projection (messageId, sender, createdAt, and parsed type, summary, task, files only). Newest first.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T', maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 200 } },
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

const brainDefinitions: Readonly<Record<BrainToolName, Tool>> = {
  remember: {
    name: 'remember', description: 'Append one immutable company-brain entry (derived context, not evidence). Idempotent on entry_id; a correction is a new entry that supersedes the old one. Only human:* or *:primary identities may write principles.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, kind: { type: 'string', enum: [...brainKinds] },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        body: { type: 'string', minLength: 1, maxLength: BRAIN_BODY_MAX_BYTES },
        source_ids: evidenceIds, entry_id: identifier, supersedes: identifier,
        status: { type: 'string', enum: ['active', 'retired'] } },
      required: ['identity', 'scope', 'kind', 'title', 'body', 'source_ids'] },
  },
  recall: {
    name: 'recall', description: 'Recall active company-brain entries ranked by simple text match plus recency.',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, query: { type: 'string', maxLength: 500 },
        kinds: { type: 'array', maxItems: brainKinds.length, uniqueItems: true, items: { type: 'string', enum: [...brainKinds] } },
        limit: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['identity', 'scope'] },
  },
};

const overlapDefinitions: Readonly<Record<OverlapToolName, Tool>> = {
  check_overlap: {
    name: 'check_overlap', description: 'Before starting work, check whether another identity is already doing a semantically similar task. Returns the top matches from other identities (similarity, owner, task, status, last update, citations). A match with similarity >= 0.82 is flagged as a collision: coordinate with its owner first. Uses Voyage embeddings + Atlas Vector Search when configured, otherwise deterministic token overlap (method "lexical").',
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { identity: identifier, scope: identifier, task_text: { type: 'string', minLength: 1, maxLength: 2000 },
        files: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 256 } } },
      required: ['identity', 'scope', 'task_text'] },
  },
};

function requireCoordinationScope(principal: Principal, args: Record<string, unknown>): string {
  if (args.scope !== principal.coordinationScope) throw new CoordinationError('INVALID_INPUT');
  return args.scope as string;
}

async function requireRegistered(repository: CoordinationRepository, identity: string, scope: string): Promise<void> {
  if (!await repository.getContext(identity, scope)) throw new CoordinationError('NOT_FOUND');
}

export function coordinationHandlers(repository: () => Promise<CoordinationRepository>,
  brain?: () => Promise<BrainRepository>, overlap?: OverlapService): DomainHandlers {
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
      const context = await (await repository()).getContext(args.identity as string, scope);
      return { projectScope: principal.scope, coordinationScope: scope, context,
        ...(brain ? { brain: await brainDigest(await brain(), scope) } : {}) };
    } },
    publish_surface: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      const surface = await repo.publishSurface({ surfaceName: args.surface_name as string, coordinationScope: scope,
        ownerIdentity: args.identity as string, kind: args.kind as string, content: args.content });
      const work = workFromSurface(surface.ownerIdentity, scope, surface.surfaceName, surface.kind, surface.content, surface.revision);
      if (work && overlap) overlap.recordInBackground(work);
      return surface;
    } },
    send_message: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      await requireRegistered(repo, args.recipient as string, scope);
      const message = await repo.sendMessage({ messageId: args.message_id as string, coordinationScope: scope,
        senderIdentity: args.identity as string, recipientIdentity: args.recipient as string,
        body: args.body as string, evidenceIds: (args.evidence_ids ?? []) as string[] });
      const work = workFromMessage(message.senderIdentity, scope, message.messageId, message.body);
      if (work && overlap) overlap.recordInBackground(work);
      return message;
    } },
    receive_inbox: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return { messages: await repo.receiveInbox(args.identity as string, scope,
        (args.limit ?? 10) as number, (args.lease_seconds ?? 300) as number) };
    } },
    read_ledger: { readOnly: true, execute: async (principal, args) => {
      // Same checks as get_context: shared token plus configured coordination scope.
      const scope = requireCoordinationScope(principal, args);
      if (args.since !== undefined && !Number.isFinite(Date.parse(args.since as string))) throw new CoordinationError('INVALID_INPUT');
      const since = args.since === undefined ? undefined : new Date(args.since as string).toISOString();
      return { coordinationScope: scope, events: await (await repository()).readLedger(scope, since, (args.limit ?? 50) as number) };
    } },
    acknowledge: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args); const repo = await repository();
      await requireRegistered(repo, args.identity as string, scope);
      return repo.acknowledge(args.identity as string, scope, args.message_id as string,
        args.lease_generation as number, args.success as boolean);
    } },
  };
}

/** Same token, scope and registration checks as the coordination write tools. */
export function brainHandlers(coordination: () => Promise<CoordinationRepository>,
  brain: () => Promise<BrainRepository>): DomainHandlers {
  return {
    remember: { readOnly: false, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args);
      await requireRegistered(await coordination(), args.identity as string, scope);
      return (await (await brain()).remember({ scope, kind: args.kind as BrainKind, title: args.title as string,
        body: args.body as string, sourceIds: args.source_ids as string[], author: args.identity as string,
        entryId: args.entry_id as string | undefined, supersedes: args.supersedes as string | undefined,
        status: args.status as 'active' | 'retired' | undefined })).entry;
    } },
    recall: { readOnly: true, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args);
      await requireRegistered(await coordination(), args.identity as string, scope);
      return { entries: await (await brain()).recall(scope, { query: args.query as string | undefined,
        kinds: args.kinds as BrainKind[] | undefined, limit: (args.limit ?? 10) as number }) };
    } },
  };
}

/** Read-only propose-time duplicate-work check (issue #53). */
export function overlapHandlers(coordination: () => Promise<CoordinationRepository>, overlap: OverlapService): DomainHandlers {
  return {
    check_overlap: { readOnly: true, execute: async (principal, args) => {
      const scope = requireCoordinationScope(principal, args);
      await requireRegistered(await coordination(), args.identity as string, scope);
      return { coordinationScope: scope, ...await overlap.check(scope, args.identity as string,
        args.task_text as string, (args.files ?? []) as string[]) };
    } },
  };
}

const validator = new Ajv({ strict: true, allErrors: false });
const definitions = new Map<string, Tool>([
  ...Object.entries(toolDefinitions).map(([name, definition]) => [name, {
    ...definition, inputSchema: definition.inputSchema as Tool['inputSchema'],
  }] as const),
  ...Object.entries(coordinationDefinitions),
  ...Object.entries(brainDefinitions),
  ...Object.entries(overlapDefinitions),
]);
const schemas = new Map([...definitions].map(([name, definition]) => [name, validator.compile(definition.inputSchema)]));
function errorResult(code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: code }] };
}
export function createDomainServer(principal: Principal, handlers: DomainHandlers, telemetry: Telemetry = noTelemetry, parentId?: string): Server {
  const identity = structuredClone(principal);
  const available = identity.allowedTools.filter(name => handlers[name] !== undefined);
  const server = new Server({ name: 'context-plane', version: '1.0.0' }, { capabilities: { tools: {} },
    instructions: 'Coordinate durable project context and read product evidence. Never publish credentials, hidden reasoning, or invented progress.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: available.map(name => ({
    ...definitions.get(name)!,
    annotations: { readOnlyHint: handlers[name]!.readOnly, destructiveHint: !handlers[name]!.readOnly,
      idempotentHint: handlers[name]!.readOnly, openWorldHint: false },
  })) }));
  const executeTool = async (request: { params: { name: string; arguments?: Record<string, unknown> } }): Promise<CallToolResult> => {
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
  };
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const startedAt = Date.now();
    const result = await executeTool(request);
    const known = available.includes(request.params.name as ImplementedToolName);
    const first = result.content[0];
    telemetry.record({ id: traceId(), name: `mcp.tool.${known ? request.params.name : 'unavailable'}`,
      kind: 'tool', startedAt, endedAt: Date.now(), parentId,
      ...(result.isError ? { error: first?.type === 'text' ? first.text : 'TOOL_ERROR' } : {}),
      metadata: { orgId: identity.scope.orgId, projectId: identity.scope.projectId,
        coordinationScope: identity.coordinationScope,
        declaredAgent: agentLabel(request.params.arguments?.identity),
        outcome: result.isError ? 'error' : 'success' },
    });
    return result;
  });
  return server;
}
