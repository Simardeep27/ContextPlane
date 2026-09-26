import { createHash } from 'node:crypto';
import type { Db, Filter } from 'mongodb';
import { MongoServerError } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';
import { CoordinationError } from './coordination.js';

/**
 * Company brain: derived context (ONTOLOGY.md §6) stored as immutable entries.
 * It cites source IDs and is never authoritative evidence or an authorization source.
 */
export const brainKinds = ['principle', 'insight', 'episode', 'decision', 'preference'] as const;
export type BrainKind = (typeof brainKinds)[number];
export type BrainStatus = 'active' | 'retired';
export const BRAIN_BODY_MAX_BYTES = 4096;

export interface BrainEntry {
  readonly entryId: string;
  readonly scope: string;
  readonly kind: BrainKind;
  readonly title: string;
  readonly body: string;
  readonly sourceIds: readonly string[];
  readonly author: string;
  readonly createdAt: string;
  readonly supersedes?: string;
  readonly status: BrainStatus;
}

export type BrainInput = Pick<BrainEntry, 'scope' | 'kind' | 'title' | 'body' | 'sourceIds' | 'author'> &
  { entryId?: string; supersedes?: string; status?: BrainStatus };

export interface RecallQuery { readonly query?: string; readonly kinds?: readonly BrainKind[]; readonly limit: number }
export interface BrainDigest { readonly principles: readonly BrainEntry[]; readonly insights: readonly BrainEntry[] }

export interface BrainRepository {
  initialize(): Promise<void>;
  /** Idempotent on entryId. Returns the stored entry and whether this call created it. */
  remember(input: BrainInput): Promise<{ entry: BrainEntry; created: boolean }>;
  /** Active, non-superseded entries ranked by text match plus recency. */
  recall(scope: string, query: RecallQuery): Promise<readonly BrainEntry[]>;
  /** All entries (any status) whose entryId starts with prefix, newest first. Used by the steward. */
  listByPrefix(scope: string, prefix: string, limit: number): Promise<readonly BrainEntry[]>;
}

/** Humans (`human:*`) or a person's primary agent (`*:primary`) may write principles. */
export function mayWritePrinciple(identity: string): boolean {
  return /^human:[^\s]+$/.test(identity) || /^[^\s:]+:primary$/.test(identity);
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function defaultEntryId(input: BrainInput): string {
  return `${input.kind}:${digest([input.author, input.kind, input.title, input.body, input.supersedes ?? null]).slice(0, 24)}`;
}

function normalize(input: BrainInput, createdAt: string): BrainEntry {
  if (!brainKinds.includes(input.kind)) throw new CoordinationError('INVALID_INPUT');
  if (Buffer.byteLength(input.body) > BRAIN_BODY_MAX_BYTES || !input.title.trim() || !input.body.trim()) {
    throw new CoordinationError('INVALID_INPUT');
  }
  if (input.kind === 'principle' && !mayWritePrinciple(input.author)) throw new CoordinationError('FORBIDDEN');
  const entryId = input.entryId ?? defaultEntryId(input);
  if (input.supersedes === entryId) throw new CoordinationError('INVALID_INPUT');
  return { entryId, scope: input.scope, kind: input.kind, title: input.title, body: input.body,
    sourceIds: [...input.sourceIds], author: input.author, createdAt, status: input.status ?? 'active',
    ...(input.supersedes ? { supersedes: input.supersedes } : {}) };
}

/** Replays must carry the same meaning; timestamps are assigned by the first write. */
function sameMeaning(left: BrainEntry, right: BrainEntry): boolean {
  const stable = (entry: BrainEntry) => [entry.kind, entry.title, entry.body, entry.sourceIds, entry.author,
    entry.supersedes ?? null, entry.status];
  return digest(stable(left)) === digest(stable(right));
}

function terms(query: string | undefined): string[] {
  return [...new Set((query ?? '').toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length >= 2))].slice(0, 8);
}

/** Score = matched terms (title counts double) + recency decay (half-life 7 days). Ties: newest first. */
export function rank(entries: readonly BrainEntry[], query: string | undefined, now: Date, limit: number): BrainEntry[] {
  const words = terms(query);
  const scored = entries.map(entry => {
    const title = entry.title.toLowerCase(); const body = entry.body.toLowerCase();
    const match = words.reduce((sum, word) => sum + (title.includes(word) ? 2 : 0) + (body.includes(word) ? 1 : 0), 0);
    const ageDays = Math.max(0, now.getTime() - Date.parse(entry.createdAt)) / 86_400_000;
    return { entry, match, score: match + Math.pow(0.5, ageDays / 7) };
  }).filter(item => words.length === 0 || item.match > 0);
  scored.sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt));
  return scored.slice(0, limit).map(item => item.entry);
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

interface BrainDocument extends BrainEntry { _id: string; orgId: string; projectId: string }
const CANDIDATES = 500;

export class MongoBrainRepository implements BrainRepository {
  constructor(private readonly db: Db, private readonly scope: ProjectScope,
    private readonly clock: () => Date = () => new Date()) {}

  private get collection() { return this.db.collection<BrainDocument>('cp_brain_entries'); }
  private documentId(scope: string, entryId: string): string {
    return digest([this.scope.orgId, this.scope.projectId, scope, 'brain', entryId]);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ orgId: 1, projectId: 1, scope: 1, entryId: 1 }, { unique: true, name: 'scope_entry' }),
      this.collection.createIndex({ orgId: 1, projectId: 1, scope: 1, status: 1, kind: 1, createdAt: -1 }, { name: 'recall' }),
      this.collection.createIndex({ orgId: 1, projectId: 1, scope: 1, supersedes: 1 }, { name: 'supersedes', sparse: true }),
    ]);
  }

  async remember(input: BrainInput): Promise<{ entry: BrainEntry; created: boolean }> {
    const entry = normalize(input, this.clock().toISOString());
    const _id = this.documentId(entry.scope, entry.entryId);
    const strip = ({ _id: a, orgId: b, projectId: c, ...value }: BrainDocument): BrainEntry => { void a; void b; void c; return value; };
    const existing = await this.collection.findOne({ _id });
    if (existing) {
      if (!sameMeaning(strip(existing), entry)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return { entry: strip(existing), created: false };
    }
    try {
      await this.collection.insertOne({ _id, orgId: this.scope.orgId, projectId: this.scope.projectId, ...entry });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return this.remember(input);
      throw error;
    }
    return { entry, created: true };
  }

  async recall(scope: string, query: RecallQuery): Promise<readonly BrainEntry[]> {
    const words = terms(query.query);
    const filter: Filter<BrainDocument> = { orgId: this.scope.orgId, projectId: this.scope.projectId, scope, status: 'active',
      ...(query.kinds?.length ? { kind: { $in: [...query.kinds] } } : {}),
      ...(words.length ? { $or: words.flatMap(word => {
        const pattern = new RegExp(escapeRegex(word), 'i');
        return [{ title: pattern }, { body: pattern }];
      }) } : {}) };
    const candidates = await this.collection.find(filter, { projection: { _id: 0, orgId: 0, projectId: 0 } })
      .sort({ createdAt: -1 }).limit(CANDIDATES).toArray() as unknown as BrainEntry[];
    if (!candidates.length) return [];
    const superseded = new Set((await this.collection.find({ orgId: this.scope.orgId, projectId: this.scope.projectId, scope,
      supersedes: { $in: candidates.map(entry => entry.entryId) } }, { projection: { supersedes: 1 } }).toArray())
      .map(entry => entry.supersedes));
    return rank(candidates.filter(entry => !superseded.has(entry.entryId)), query.query, this.clock(), query.limit);
  }

  async listByPrefix(scope: string, prefix: string, limit: number): Promise<readonly BrainEntry[]> {
    return await this.collection.find({ orgId: this.scope.orgId, projectId: this.scope.projectId, scope,
      entryId: { $regex: `^${escapeRegex(prefix)}` } }, { projection: { _id: 0, orgId: 0, projectId: 0 } })
      .sort({ createdAt: -1 }).limit(limit).toArray() as unknown as BrainEntry[];
  }
}

/** Deterministic in-process repository used by tests and the steward's fixtures. */
export class MemoryBrainRepository implements BrainRepository {
  readonly entries = new Map<string, BrainEntry>();
  constructor(private readonly clock: () => Date = () => new Date()) {}
  async initialize(): Promise<void> {}
  private key(scope: string, entryId: string) { return JSON.stringify([scope, entryId]); }

  async remember(input: BrainInput): Promise<{ entry: BrainEntry; created: boolean }> {
    const entry = normalize(input, this.clock().toISOString());
    const existing = this.entries.get(this.key(entry.scope, entry.entryId));
    if (existing) {
      if (!sameMeaning(existing, entry)) throw new CoordinationError('IDEMPOTENCY_CONFLICT');
      return { entry: structuredClone(existing), created: false };
    }
    this.entries.set(this.key(entry.scope, entry.entryId), structuredClone(entry));
    return { entry, created: true };
  }

  async recall(scope: string, query: RecallQuery): Promise<readonly BrainEntry[]> {
    const all = [...this.entries.values()].filter(entry => entry.scope === scope);
    const superseded = new Set(all.map(entry => entry.supersedes).filter(Boolean));
    return structuredClone(rank(all.filter(entry => entry.status === 'active' && !superseded.has(entry.entryId) &&
      (!query.kinds?.length || query.kinds.includes(entry.kind))), query.query, this.clock(), query.limit));
  }

  async listByPrefix(scope: string, prefix: string, limit: number): Promise<readonly BrainEntry[]> {
    return structuredClone([...this.entries.values()].filter(entry => entry.scope === scope && entry.entryId.startsWith(prefix))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }
}

const DIGEST_BODY_CHARS = 1024;
function brief(entry: BrainEntry): BrainEntry {
  return entry.body.length <= DIGEST_BODY_CHARS ? entry : { ...entry, body: `${entry.body.slice(0, DIGEST_BODY_CHARS)}…` };
}

/** Bounded brain digest for get_context: up to 7 principles and the 5 most recent insights. */
export async function brainDigest(repository: BrainRepository, scope: string): Promise<BrainDigest> {
  const [principles, insights] = await Promise.all([
    repository.recall(scope, { kinds: ['principle'], limit: 7 }),
    repository.recall(scope, { kinds: ['insight'], limit: 50 }),
  ]);
  return { principles: principles.map(brief),
    insights: [...insights].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(brief) };
}
