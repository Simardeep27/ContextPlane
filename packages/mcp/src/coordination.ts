import { createHash } from 'node:crypto';
import type { Db, Filter } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';

export type CoordinationToolName =
  | 'register_agent'
  | 'register_dependency'
  | 'get_context'
  | 'publish_surface'
  | 'send_message'
  | 'receive_inbox'
  | 'acknowledge';

export interface CoordinationAgent {
  readonly identity: string;
  readonly coordinationScope: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly registeredAt: string;
}

export interface CoordinationDependency {
  readonly dependencyId: string;
  readonly coordinationScope: string;
  readonly ownerIdentity: string;
  readonly dependsOn: string;
  readonly description: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface CoordinationSurface {
  readonly surfaceName: string;
  readonly coordinationScope: string;
  readonly ownerIdentity: string;
  readonly kind: string;
  readonly content: unknown;
  readonly contentHash: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface CoordinationMessage {
  readonly messageId: string;
  readonly coordinationScope: string;
  readonly senderIdentity: string;
  readonly recipientIdentity: string;
  readonly body: string;
  readonly evidenceIds: readonly string[];
  readonly status: 'pending' | 'leased' | 'acknowledged';
  readonly leaseGeneration: number;
  readonly leaseExpiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CoordinationContext {
  readonly agent: CoordinationAgent;
  readonly dependencies: readonly CoordinationDependency[];
  readonly surfaces: readonly CoordinationSurface[];
}

export interface CoordinationRepository {
  initialize(): Promise<void>;
  registerAgent(input: Pick<CoordinationAgent, 'identity' | 'coordinationScope' | 'metadata'>): Promise<CoordinationAgent>;
  registerDependency(input: Pick<CoordinationDependency,
    'dependencyId' | 'coordinationScope' | 'ownerIdentity' | 'dependsOn' | 'description'>): Promise<CoordinationDependency>;
  getContext(identity: string, coordinationScope: string): Promise<CoordinationContext | null>;
  publishSurface(input: Pick<CoordinationSurface,
    'surfaceName' | 'coordinationScope' | 'ownerIdentity' | 'kind' | 'content'>): Promise<CoordinationSurface>;
  sendMessage(input: Pick<CoordinationMessage,
    'messageId' | 'coordinationScope' | 'senderIdentity' | 'recipientIdentity' | 'body' | 'evidenceIds'>): Promise<CoordinationMessage>;
  receiveInbox(identity: string, coordinationScope: string, limit: number, leaseSeconds: number): Promise<readonly CoordinationMessage[]>;
  acknowledge(identity: string, coordinationScope: string, messageId: string,
    leaseGeneration: number, success: boolean): Promise<CoordinationMessage>;
}

interface ScopedDocument { _id: string; orgId: string; projectId: string }
type AgentDocument = ScopedDocument & CoordinationAgent;
type DependencyDocument = ScopedDocument & CoordinationDependency;
type SurfaceDocument = ScopedDocument & CoordinationSurface;
type MessageDocument = ScopedDocument & CoordinationMessage;

export class CoordinationError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'LEASE_LOST') {
    super(code); this.name = 'CoordinationError';
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object') throw new CoordinationError('INVALID_INPUT');
  return `{${Object.keys(value as object).sort().map(key =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized) > 128 * 1024) throw new CoordinationError('INVALID_INPUT');
  return createHash('sha256').update(serialized).digest('hex');
}

function id(scope: ProjectScope, coordinationScope: string, kind: string, key: string): string {
  return hash([scope.orgId, scope.projectId, coordinationScope, kind, key]);
}

function stripScope<T extends ScopedDocument>(document: T): Omit<T, keyof ScopedDocument> {
  const { _id: ignoredId, orgId: ignoredOrg, projectId: ignoredProject, ...value } = document;
  void ignoredId; void ignoredOrg; void ignoredProject;
  return value as Omit<T, keyof ScopedDocument>;
}

export class MongoCoordinationRepository implements CoordinationRepository {
  constructor(private readonly db: Db, private readonly scope: ProjectScope) {}

  async initialize(): Promise<void> {
    await Promise.all([
      this.db.collection<AgentDocument>('cp_coordination_agents').createIndex(
        { orgId: 1, projectId: 1, coordinationScope: 1, identity: 1 }, { unique: true, name: 'scope_identity' }),
      this.db.collection<DependencyDocument>('cp_coordination_dependencies').createIndex(
        { orgId: 1, projectId: 1, coordinationScope: 1, dependencyId: 1 }, { unique: true, name: 'scope_dependency' }),
      this.db.collection<SurfaceDocument>('cp_coordination_surfaces').createIndex(
        { orgId: 1, projectId: 1, coordinationScope: 1, ownerIdentity: 1, surfaceName: 1 },
        { unique: true, name: 'scope_owner_surface' }),
      this.db.collection<MessageDocument>('cp_coordination_messages').createIndex(
        { orgId: 1, projectId: 1, coordinationScope: 1, recipientIdentity: 1, status: 1, createdAt: 1 },
        { name: 'inbox' }),
    ]);
  }

  private scoped<T extends ScopedDocument>(value: Omit<T, keyof ScopedDocument>, documentId: string): T {
    return { _id: documentId, orgId: this.scope.orgId, projectId: this.scope.projectId,
      ...value } as unknown as T;
  }

  async registerAgent(input: Pick<CoordinationAgent, 'identity' | 'coordinationScope' | 'metadata'>): Promise<CoordinationAgent> {
    const collection = this.db.collection<AgentDocument>('cp_coordination_agents');
    const documentId = id(this.scope, input.coordinationScope, 'agent', input.identity);
    const existing = await collection.findOne({ _id: documentId });
    if (existing) {
      if (hash(existing.metadata) !== hash(input.metadata)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return stripScope(existing);
    }
    const value: CoordinationAgent = { ...input, registeredAt: new Date().toISOString() };
    try { await collection.insertOne(this.scoped<AgentDocument>(value, documentId)); }
    catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      const raced = await collection.findOne({ _id: documentId });
      if (!raced || hash(raced.metadata) !== hash(input.metadata)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return stripScope(raced);
    }
    return value;
  }

  async registerDependency(input: Pick<CoordinationDependency,
    'dependencyId' | 'coordinationScope' | 'ownerIdentity' | 'dependsOn' | 'description'>): Promise<CoordinationDependency> {
    const collection = this.db.collection<DependencyDocument>('cp_coordination_dependencies');
    const documentId = id(this.scope, input.coordinationScope, 'dependency', input.dependencyId);
    const existing = await collection.findOne({ _id: documentId });
    if (existing && existing.ownerIdentity !== input.ownerIdentity) throw new CoordinationError('CONFLICT');
    if (existing && existing.ownerIdentity === input.ownerIdentity && existing.dependsOn === input.dependsOn &&
      existing.description === input.description) return stripScope(existing);
    const value: CoordinationDependency = { ...input, revision: (existing?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    const result = await collection.replaceOne({ _id: documentId, ...(existing ? { revision: existing.revision } : {}) },
      this.scoped<DependencyDocument>(value, documentId), { upsert: !existing });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new CoordinationError('CONFLICT');
    return value;
  }

  async getContext(identity: string, coordinationScope: string): Promise<CoordinationContext | null> {
    const agent = await this.db.collection<AgentDocument>('cp_coordination_agents').findOne({
      _id: id(this.scope, coordinationScope, 'agent', identity),
    });
    if (!agent) return null;
    const base = { orgId: this.scope.orgId, projectId: this.scope.projectId, coordinationScope };
    const [dependencies, surfaces] = await Promise.all([
      this.db.collection<DependencyDocument>('cp_coordination_dependencies').find({ ...base,
        $or: [{ ownerIdentity: identity }, { dependsOn: identity }] }).sort({ dependencyId: 1 }).limit(100).toArray(),
      this.db.collection<SurfaceDocument>('cp_coordination_surfaces').find(base).sort({ updatedAt: -1 }).limit(100).toArray(),
    ]);
    return { agent: stripScope(agent), dependencies: dependencies.map(stripScope), surfaces: surfaces.map(stripScope) };
  }

  async publishSurface(input: Pick<CoordinationSurface,
    'surfaceName' | 'coordinationScope' | 'ownerIdentity' | 'kind' | 'content'>): Promise<CoordinationSurface> {
    const collection = this.db.collection<SurfaceDocument>('cp_coordination_surfaces');
    const documentId = id(this.scope, input.coordinationScope, 'surface', canonical([input.ownerIdentity, input.surfaceName]));
    // Preserve an existing legacy record only when both original key components match.
    const legacyId = id(this.scope, input.coordinationScope, 'surface', `${input.ownerIdentity}:${input.surfaceName}`);
    const existing = await collection.findOne({ _id: documentId }) ?? await collection.findOne({
      _id: legacyId, ownerIdentity: input.ownerIdentity, surfaceName: input.surfaceName,
    });
    const contentHash = hash(input.content);
    if (existing && existing.kind === input.kind && existing.contentHash === contentHash) return stripScope(existing);
    const value: CoordinationSurface = { ...input, contentHash, revision: (existing?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString() };
    const writeId = existing?._id ?? documentId;
    const result = await collection.replaceOne({ _id: writeId, ...(existing ? { revision: existing.revision } : {}) },
      this.scoped<SurfaceDocument>(value, writeId), { upsert: !existing });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new CoordinationError('CONFLICT');
    return value;
  }

  async sendMessage(input: Pick<CoordinationMessage,
    'messageId' | 'coordinationScope' | 'senderIdentity' | 'recipientIdentity' | 'body' | 'evidenceIds'>): Promise<CoordinationMessage> {
    const collection = this.db.collection<MessageDocument>('cp_coordination_messages');
    const documentId = id(this.scope, input.coordinationScope, 'message', input.messageId);
    const existing = await collection.findOne({ _id: documentId });
    const now = new Date().toISOString();
    const value: CoordinationMessage = { ...input, status: 'pending', leaseGeneration: 0, createdAt: now, updatedAt: now };
    if (existing) {
      const previous = stripScope(existing);
      const { status: ignoredStatus, leaseGeneration: ignoredGeneration, leaseExpiresAt: ignoredExpiry,
        createdAt: ignoredCreated, updatedAt: ignoredUpdated, ...stable } = previous;
      void ignoredStatus; void ignoredGeneration; void ignoredExpiry; void ignoredCreated; void ignoredUpdated;
      const { status: nextStatus, leaseGeneration: nextGeneration, createdAt: nextCreated,
        updatedAt: nextUpdated, ...expected } = value;
      void nextStatus; void nextGeneration; void nextCreated; void nextUpdated;
      if (hash(stable) !== hash(expected)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return previous;
    }
    try { await collection.insertOne(this.scoped<MessageDocument>(value, documentId)); }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        // The winner is durable now; re-read it through the same exact replay check.
        return this.sendMessage(input);
      }
      throw error;
    }
    return value;
  }

  async receiveInbox(identity: string, coordinationScope: string, limit: number,
    leaseSeconds: number): Promise<readonly CoordinationMessage[]> {
    const collection = this.db.collection<MessageDocument>('cp_coordination_messages');
    const claimed: CoordinationMessage[] = [];
    for (let index = 0; index < limit; index++) {
      const now = new Date(); const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      const filter: Filter<MessageDocument> = { orgId: this.scope.orgId, projectId: this.scope.projectId,
        coordinationScope, recipientIdentity: identity,
        $or: [{ status: 'pending' }, { status: 'leased', leaseExpiresAt: { $lte: now.toISOString() } }] };
      const message = await collection.findOneAndUpdate(filter, { $set: { status: 'leased', leaseExpiresAt: expiresAt,
        updatedAt: now.toISOString() }, $inc: { leaseGeneration: 1 } }, { sort: { createdAt: 1 }, returnDocument: 'after' });
      if (!message) break;
      claimed.push(stripScope(message));
    }
    return claimed;
  }

  async acknowledge(identity: string, coordinationScope: string, messageId: string,
    leaseGeneration: number, success: boolean): Promise<CoordinationMessage> {
    const collection = this.db.collection<MessageDocument>('cp_coordination_messages');
    const documentId = id(this.scope, coordinationScope, 'message', messageId);
    const now = new Date().toISOString();
    const message = await collection.findOneAndUpdate({ _id: documentId, recipientIdentity: identity,
      coordinationScope, status: 'leased', leaseGeneration, leaseExpiresAt: { $gt: now } }, success
      ? { $set: { status: 'acknowledged', updatedAt: now }, $unset: { leaseExpiresAt: '' } }
      : { $set: { status: 'pending', updatedAt: now }, $unset: { leaseExpiresAt: '' } },
    { returnDocument: 'after' });
    const completed = message ?? await collection.findOne({ _id: documentId, recipientIdentity: identity,
      coordinationScope, leaseGeneration, status: success ? 'acknowledged' : 'pending' });
    if (!completed) throw new CoordinationError('LEASE_LOST');
    return stripScope(completed);
  }
}

/** Deterministic in-process repository used by MCP contract tests. */
export class MemoryCoordinationRepository implements CoordinationRepository {
  private readonly agents = new Map<string, CoordinationAgent>();
  private readonly dependencies = new Map<string, CoordinationDependency>();
  private readonly surfaces = new Map<string, CoordinationSurface>();
  private readonly messages = new Map<string, CoordinationMessage>();

  constructor(private readonly clock: () => Date = () => new Date()) {}
  async initialize(): Promise<void> {}
  private key(scope: string, key: string): string { return JSON.stringify([scope, key]); }

  async registerAgent(input: Pick<CoordinationAgent, 'identity' | 'coordinationScope' | 'metadata'>): Promise<CoordinationAgent> {
    const key = this.key(input.coordinationScope, input.identity); const existing = this.agents.get(key);
    if (existing) {
      if (hash(existing.metadata) !== hash(input.metadata)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return structuredClone(existing);
    }
    const value = { ...input, registeredAt: this.clock().toISOString() };
    this.agents.set(key, structuredClone(value)); return value;
  }

  async registerDependency(input: Pick<CoordinationDependency,
    'dependencyId' | 'coordinationScope' | 'ownerIdentity' | 'dependsOn' | 'description'>): Promise<CoordinationDependency> {
    const key = this.key(input.coordinationScope, input.dependencyId); const existing = this.dependencies.get(key);
    if (existing && existing.ownerIdentity !== input.ownerIdentity) throw new CoordinationError('CONFLICT');
    if (existing && existing.ownerIdentity === input.ownerIdentity && existing.dependsOn === input.dependsOn &&
      existing.description === input.description) return structuredClone(existing);
    const value = { ...input, revision: (existing?.revision ?? 0) + 1, updatedAt: this.clock().toISOString() };
    this.dependencies.set(key, structuredClone(value)); return value;
  }

  async getContext(identity: string, coordinationScope: string): Promise<CoordinationContext | null> {
    const agent = this.agents.get(this.key(coordinationScope, identity)); if (!agent) return null;
    return structuredClone({ agent,
      dependencies: [...this.dependencies.values()].filter(item => item.coordinationScope === coordinationScope &&
        (item.ownerIdentity === identity || item.dependsOn === identity)),
      surfaces: [...this.surfaces.values()].filter(item => item.coordinationScope === coordinationScope),
    });
  }

  async publishSurface(input: Pick<CoordinationSurface,
    'surfaceName' | 'coordinationScope' | 'ownerIdentity' | 'kind' | 'content'>): Promise<CoordinationSurface> {
    const key = this.key(input.coordinationScope, canonical([input.ownerIdentity, input.surfaceName]));
    const existing = this.surfaces.get(key); const contentHash = hash(input.content);
    if (existing && existing.kind === input.kind && existing.contentHash === contentHash) return structuredClone(existing);
    const value = { ...input, contentHash, revision: (existing?.revision ?? 0) + 1,
      updatedAt: this.clock().toISOString() };
    this.surfaces.set(key, structuredClone(value)); return value;
  }

  async sendMessage(input: Pick<CoordinationMessage,
    'messageId' | 'coordinationScope' | 'senderIdentity' | 'recipientIdentity' | 'body' | 'evidenceIds'>): Promise<CoordinationMessage> {
    const key = this.key(input.coordinationScope, input.messageId); const existing = this.messages.get(key);
    if (existing) {
      if (existing.senderIdentity !== input.senderIdentity || existing.recipientIdentity !== input.recipientIdentity ||
        existing.body !== input.body || hash(existing.evidenceIds) !== hash(input.evidenceIds)) {
        throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      }
      return structuredClone(existing);
    }
    const now = this.clock().toISOString();
    const value: CoordinationMessage = { ...input, status: 'pending', leaseGeneration: 0,
      createdAt: now, updatedAt: now };
    this.messages.set(key, structuredClone(value)); return value;
  }

  async receiveInbox(identity: string, coordinationScope: string, limit: number,
    leaseSeconds: number): Promise<readonly CoordinationMessage[]> {
    const now = this.clock(); const claimed: CoordinationMessage[] = [];
    const candidates = [...this.messages.entries()].filter(([, message]) => message.coordinationScope === coordinationScope &&
      message.recipientIdentity === identity && (message.status === 'pending' ||
        (message.status === 'leased' && Date.parse(message.leaseExpiresAt ?? '') <= now.getTime())))
      .sort(([, left], [, right]) => left.createdAt.localeCompare(right.createdAt)).slice(0, limit);
    for (const [key, message] of candidates) {
      const value: CoordinationMessage = { ...message, status: 'leased', leaseGeneration: message.leaseGeneration + 1,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(), updatedAt: now.toISOString() };
      this.messages.set(key, structuredClone(value)); claimed.push(value);
    }
    return structuredClone(claimed);
  }

  async acknowledge(identity: string, coordinationScope: string, messageId: string,
    leaseGeneration: number, success: boolean): Promise<CoordinationMessage> {
    const key = this.key(coordinationScope, messageId); const existing = this.messages.get(key);
    if (!existing || existing.recipientIdentity !== identity ||
      existing.leaseGeneration !== leaseGeneration) throw new CoordinationError('LEASE_LOST');
    if (existing.status === (success ? 'acknowledged' : 'pending')) return structuredClone(existing);
    if (existing.status !== 'leased' || Date.parse(existing.leaseExpiresAt ?? '') <= this.clock().getTime()) {
      throw new CoordinationError('LEASE_LOST');
    }
    const { leaseExpiresAt: ignored, ...base } = existing; void ignored;
    const value: CoordinationMessage = { ...base, status: success ? 'acknowledged' : 'pending',
      updatedAt: this.clock().toISOString() };
    this.messages.set(key, structuredClone(value)); return value;
  }
}
