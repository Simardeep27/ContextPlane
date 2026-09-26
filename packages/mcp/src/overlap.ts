import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';

/**
 * Propose-time duplicate-work detection (issue #53).
 *
 * One record per (scope, identity) holds that identity's current task, taken from
 * `work-status` surfaces and `work_started` reports. `check_overlap` embeds the
 * proposed task (Voyage) and runs Atlas `$vectorSearch`; without a key, an index,
 * or a stored embedding it falls back to deterministic token overlap.
 * These records are derived context, never authorization or proof of work.
 */
export const WORK_EMBEDDINGS_COLLECTION = 'cp_work_embeddings';
export const WORK_EMBEDDINGS_INDEX = 'cp_work_embeddings_vector';
export const EMBEDDING_DIMENSIONS = 1024;
export const COLLISION_THRESHOLD = 0.82;
const TASK_MAX = 2000;

export interface WorkRecord {
  readonly scope: string;
  readonly identity: string;
  readonly task: string;
  readonly status: string | null;
  readonly files: readonly string[];
  readonly citations: readonly string[];
  readonly source: 'work-status' | 'work_started';
  readonly updatedAt: string;
  readonly embedding?: readonly number[];
  readonly embeddingModel?: string;
}

export interface OverlapMatch {
  readonly identity: string;
  readonly task: string;
  readonly status: string | null;
  readonly updatedAt: string;
  readonly similarity: number;
  readonly collision: boolean;
  readonly sharedFiles: readonly string[];
  readonly citations: readonly string[];
}

export interface OverlapResult {
  readonly method: 'vector' | 'lexical';
  readonly threshold: number;
  readonly collision: boolean;
  readonly matches: readonly OverlapMatch[];
  readonly fallbackReason?: string;
}

export interface Embedder {
  readonly model: string;
  embed(text: string, inputType: 'query' | 'document'): Promise<number[]>;
}

/** Storage seam: Atlas in production, an in-memory fake in tests (local Mongo has no $vectorSearch). */
export interface WorkEmbeddingStore {
  upsert(record: WorkRecord): Promise<void>;
  /** Nearest records by cosine similarity (-1..1), excluding one identity. Throws when search is unavailable. */
  vectorSearch(scope: string, vector: readonly number[], excludeIdentity: string, limit: number):
    Promise<ReadonlyArray<{ record: WorkRecord; similarity: number }>>;
  /** Bounded recent records for the lexical fallback. */
  list(scope: string, limit: number): Promise<readonly WorkRecord[]>;
}

export function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2));
}

/** Deterministic Jaccard similarity over normalized word tokens. */
export function lexicalSimilarity(left: string, right: string): number {
  const a = tokens(left); const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0; for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0; let l = 0; let r = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!; l += left[index]! ** 2; r += right[index]! ** 2;
  }
  return l === 0 || r === 0 ? 0 : dot / Math.sqrt(l * r);
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const clip = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const fileList = (value: unknown): string[] => Array.isArray(value)
  ? value.slice(0, 50).map(item => clip(item, 256)).filter((item): item is string => item !== null) : [];

/** Voyage embeddings over HTTPS. The key stays in the server environment and is never returned or logged. */
export class VoyageEmbedder implements Embedder {
  constructor(private readonly apiKey: string, readonly model = 'voyage-3.5',
    private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 5_000) {}
  async embed(text: string, inputType: 'query' | 'document'): Promise<number[]> {
    const response = await this.fetchImpl('https://api.voyageai.com/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: [text.slice(0, TASK_MAX)], model: this.model, input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS }),
    });
    if (!response.ok) throw new Error(`EMBEDDING_HTTP_${response.status}`);
    const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = body.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('EMBEDDING_INVALID');
    return vector as number[];
  }
}

export function embedderFromEnvironment(env: NodeJS.ProcessEnv = process.env): Embedder | undefined {
  const key = env.VOYAGE_API_KEY?.trim();
  return key ? new VoyageEmbedder(key, env.VOYAGE_EMBEDDING_MODEL?.trim() || 'voyage-3.5') : undefined;
}

export class OverlapService {
  private readonly inflight = new Set<Promise<void>>();
  constructor(private readonly store: WorkEmbeddingStore, private readonly embedder?: Embedder,
    private readonly clock: () => Date = () => new Date()) {}

  /** Fire-and-forget upsert. Never throws and never delays the originating tool call. */
  recordInBackground(input: Omit<WorkRecord, 'updatedAt' | 'embedding' | 'embeddingModel'>): void {
    const task = (async () => {
      let embedding: number[] | undefined;
      if (this.embedder) {
        try { embedding = await this.embedder.embed(input.task, 'document'); } catch { /* Stored lexical-only. */ }
      }
      await this.store.upsert({ ...input, task: input.task.slice(0, TASK_MAX), updatedAt: this.clock().toISOString(),
        ...(embedding && this.embedder ? { embedding, embeddingModel: this.embedder.model } : {}) });
    })().catch(() => { /* Best effort: coordination writes already succeeded. */ });
    this.inflight.add(task); void task.finally(() => this.inflight.delete(task));
  }

  /** Test/shutdown helper: resolves once in-flight background writes settle. */
  async settled(): Promise<void> { while (this.inflight.size) await Promise.all([...this.inflight]); }

  async check(scope: string, identity: string, taskText: string, files: readonly string[] = [], limit = 5): Promise<OverlapResult> {
    const decorate = (record: WorkRecord, similarity: number): OverlapMatch => ({
      identity: record.identity, task: record.task, status: record.status, updatedAt: record.updatedAt,
      similarity: round(similarity), collision: similarity >= COLLISION_THRESHOLD,
      sharedFiles: record.files.filter(file => files.includes(file)), citations: record.citations,
    });
    const finish = (method: OverlapResult['method'], matches: OverlapMatch[], fallbackReason?: string): OverlapResult => {
      const top = matches.sort((a, b) => b.similarity - a.similarity || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
      return { method, threshold: COLLISION_THRESHOLD, collision: top.some(match => match.collision), matches: top,
        ...(fallbackReason ? { fallbackReason } : {}) };
    };
    let fallbackReason = 'NO_EMBEDDING_KEY';
    if (this.embedder) {
      try {
        const vector = await this.embedder.embed(taskText, 'query');
        const hits = await this.store.vectorSearch(scope, vector, identity, limit);
        if (hits.length > 0) return finish('vector', hits.filter(hit => hit.record.identity !== identity)
          .map(hit => decorate(hit.record, hit.similarity)));
        fallbackReason = 'NO_VECTOR_MATCHES';
      } catch { fallbackReason = 'VECTOR_SEARCH_UNAVAILABLE'; }
    }
    const records = await this.store.list(scope, 500);
    return finish('lexical', records.filter(record => record.identity !== identity)
      .map(record => decorate(record, lexicalSimilarity(taskText, record.task))).filter(match => match.similarity > 0),
    fallbackReason);
  }
}

/** Extract a work record from a work-status surface; null when it carries no task. */
export function workFromSurface(identity: string, scope: string, surfaceName: string, kind: string, content: unknown,
  revision: number): Omit<WorkRecord, 'updatedAt'> | null {
  if (surfaceName !== 'work-status' && kind !== 'work-status') return null;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const body = content as Record<string, unknown>;
  const task = [clip(body.task, 1000), clip(body.currentTask, 1000)].filter((item): item is string => item !== null)
    .filter((item, index, all) => all.indexOf(item) === index).join(' — ');
  if (!task) return null;
  return { scope, identity, task, status: clip(body.status, 32), files: fileList(body.files), source: 'work-status',
    citations: [`surface:${identity}/${surfaceName}@${revision}`,
      ...(clip(body.lastEventId, 256) ? [`message:${clip(body.lastEventId, 256)}`] : [])] };
}

/** Extract a work record from a work_started report body; null for any other message. */
export function workFromMessage(identity: string, scope: string, messageId: string, rawBody: string): Omit<WorkRecord, 'updatedAt'> | null {
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const task = clip(value.task, 2000);
  if (value.type !== 'work_started' || !task) return null;
  return { scope, identity, task, status: 'working', files: fileList(value.files), source: 'work_started',
    citations: [`message:${messageId}`] };
}

type WorkDocument = WorkRecord & { _id: string; orgId: string; projectId: string };

export class MongoWorkEmbeddingStore implements WorkEmbeddingStore {
  constructor(private readonly db: Db, private readonly projectScope: ProjectScope) {}
  private get collection() { return this.db.collection<WorkDocument>(WORK_EMBEDDINGS_COLLECTION); }

  async initialize(): Promise<void> {
    await this.collection.createIndex({ orgId: 1, projectId: 1, scope: 1, updatedAt: -1 }, { name: 'scope_recent' });
  }

  async upsert(record: WorkRecord): Promise<void> {
    const _id = createHash('sha256').update(JSON.stringify([this.projectScope.orgId, this.projectScope.projectId,
      record.scope, record.identity])).digest('hex');
    const { embedding, embeddingModel, ...rest } = record;
    await this.collection.updateOne({ _id }, {
      $set: { ...rest, orgId: this.projectScope.orgId, projectId: this.projectScope.projectId,
        ...(embedding ? { embedding: [...embedding], embeddingModel } : {}) },
      // A task without a fresh embedding must not keep a stale vector for an older task.
      ...(embedding ? {} : { $unset: { embedding: '', embeddingModel: '' } }),
    }, { upsert: true });
  }

  async vectorSearch(scope: string, vector: readonly number[], excludeIdentity: string, limit: number) {
    const hits = await this.collection.aggregate<WorkDocument & { score: number }>([
      { $vectorSearch: { index: WORK_EMBEDDINGS_INDEX, path: 'embedding', queryVector: [...vector],
        numCandidates: Math.max(100, limit * 20), limit: limit + 1,
        filter: { orgId: this.projectScope.orgId, projectId: this.projectScope.projectId, scope } } },
      { $match: { identity: { $ne: excludeIdentity } } },
      { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
    ]).toArray();
    // Atlas cosine scores are (1 + cosine) / 2; report plain cosine.
    return hits.slice(0, limit).map(({ _id, orgId, projectId, score, ...record }) => {
      void _id; void orgId; void projectId;
      return { record: record as WorkRecord, similarity: score * 2 - 1 };
    });
  }

  async list(scope: string, limit: number): Promise<readonly WorkRecord[]> {
    const documents = await this.collection.find({ orgId: this.projectScope.orgId, projectId: this.projectScope.projectId,
      scope }, { projection: { _id: 0, orgId: 0, projectId: 0, embedding: 0 } }).sort({ updatedAt: -1 }).limit(limit).toArray();
    return documents as unknown as WorkRecord[];
  }
}

/** In-memory store with brute-force cosine search; stands in for Atlas in tests. */
export class MemoryWorkEmbeddingStore implements WorkEmbeddingStore {
  readonly records = new Map<string, WorkRecord>();
  constructor(private readonly vectorAvailable = true) {}
  async upsert(record: WorkRecord): Promise<void> {
    this.records.set(JSON.stringify([record.scope, record.identity]), structuredClone(record));
  }
  async vectorSearch(scope: string, vector: readonly number[], excludeIdentity: string, limit: number) {
    if (!this.vectorAvailable) throw new Error('VECTOR_SEARCH_UNAVAILABLE');
    return [...this.records.values()].filter(record => record.scope === scope && record.identity !== excludeIdentity &&
      record.embedding).map(record => ({ record, similarity: cosine(vector, record.embedding!) }))
      .sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
  async list(scope: string, limit: number): Promise<readonly WorkRecord[]> {
    return [...this.records.values()].filter(record => record.scope === scope)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
}
