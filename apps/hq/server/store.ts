import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { MongoClient, MongoServerError, type Collection, type ObjectId } from "mongodb";

import {
  isHQEvent,
  type ActorRef,
  type EventEnvelope,
  type HQEvent,
  type HQEventType,
  type PayloadByType,
  type ProjectScope,
} from "../shared/events.ts";

export type DraftEvent = {
  [T in HQEventType]: { type: T; runId: string; actor: ActorRef; payload: PayloadByType[T] };
}[HQEventType];

type Listener = (event: HQEvent) => void;

export interface EventStore {
  readonly mode: "mongodb" | "memory";
  readonly detail: string;
  append(scope: ProjectScope, draft: DraftEvent): Promise<HQEvent>;
  list(projectId: string): Promise<HQEvent[]>;
  latestProjectId(): Promise<string | null>;
  onEvent(listener: Listener): () => void;
  close(): Promise<void>;
}

function envelope(scope: ProjectScope, draft: DraftEvent, revision: number): HQEvent {
  return {
    ...draft,
    eventId: `evt_${randomUUID().slice(0, 8)}`,
    scope,
    revision,
    cursor: String(revision).padStart(6, "0"),
    occurredAt: new Date().toISOString(),
  } as HQEvent;
}

class MemoryStore implements EventStore {
  readonly mode = "memory";
  readonly detail = "In-memory store (set MONGODB_URI to persist to Atlas)";
  private readonly events: HQEvent[] = [];
  private readonly emitter = new EventEmitter();

  async append(scope: ProjectScope, draft: DraftEvent) {
    const revision = this.events.filter((e) => e.scope.projectId === scope.projectId).length + 1;
    const event = envelope(scope, draft, revision);
    this.events.push(event);
    this.emitter.emit("event", event);
    return event;
  }

  async list(projectId: string) {
    return this.events.filter((e) => e.scope.projectId === projectId);
  }

  async latestProjectId() {
    return this.events.at(-1)?.scope.projectId ?? null;
  }

  onEvent(listener: Listener) {
    this.emitter.on("event", listener);
    return () => void this.emitter.off("event", listener);
  }

  async close() {}
}

type StoredEvent = EventEnvelope & { _id?: ObjectId };

// Events are appended with a per-project revision guarded by a unique index,
// so a concurrent writer (e.g. the agent runtime) can't produce a gap or a
// duplicate. Live delivery comes from a change stream so events written by
// other processes show up in HQ too; if change streams are unavailable we
// fall back to polling by _id.
class MongoStore implements EventStore {
  readonly mode = "mongodb";
  private delivery = "connecting";
  private lastSeenId: ObjectId | null = null;
  private readonly emitter = new EventEmitter();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private pollTimer: NodeJS.Timeout | null = null;
  private stopWatching: (() => Promise<void>) | null = null;

  private constructor(
    private readonly client: MongoClient,
    private readonly events: Collection<StoredEvent>,
    private readonly dbName: string,
  ) {}

  get detail() {
    return `MongoDB · ${this.dbName}.${this.events.collectionName} · ${this.delivery}`;
  }

  static async connect(uri: string, dbName: string): Promise<MongoStore> {
    const client = new MongoClient(uri, { appName: "context-plane-hq" });
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    const events = client.db(dbName).collection<StoredEvent>("hq_events");
    await events.createIndex({ "scope.projectId": 1, revision: 1 }, { unique: true });
    const store = new MongoStore(client, events, dbName);
    await store.startWatching();
    return store;
  }

  append(scope: ProjectScope, draft: DraftEvent): Promise<HQEvent> {
    const next = this.writeQueue.then(() => this.insertWithRetry(scope, draft));
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async insertWithRetry(scope: ProjectScope, draft: DraftEvent): Promise<HQEvent> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.events.findOne(
        { "scope.projectId": scope.projectId },
        { sort: { revision: -1 }, projection: { revision: 1 } },
      );
      const event = envelope(scope, draft, (last?.revision ?? 0) + 1);
      try {
        await this.events.insertOne({ ...event });
        return event;
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) continue;
        throw error;
      }
    }
    throw new Error(`Could not append ${draft.type}: revision contention on ${scope.projectId}`);
  }

  async list(projectId: string) {
    const docs = await this.events
      .find({ "scope.projectId": projectId }, { projection: { _id: 0 } })
      .sort({ revision: 1 })
      .toArray();
    return docs.map(({ _id, ...event }): EventEnvelope => event).filter(isHQEvent);
  }

  async latestProjectId() {
    const latest = await this.events.findOne({}, { sort: { _id: -1 }, projection: { scope: 1 } });
    return latest?.scope.projectId ?? null;
  }

  onEvent(listener: Listener) {
    this.emitter.on("event", listener);
    return () => void this.emitter.off("event", listener);
  }

  private emit(doc: StoredEvent) {
    const { _id, ...event } = doc;
    if (_id && (!this.lastSeenId || _id.toHexString() > this.lastSeenId.toHexString())) this.lastSeenId = _id;
    if (isHQEvent(event)) this.emitter.emit("event", event);
  }

  private async startWatching() {
    const newest = await this.events.findOne({}, { sort: { _id: -1 }, projection: { _id: 1 } });
    this.lastSeenId = newest?._id ?? null;
    const stream = this.events.watch([{ $match: { operationType: "insert" } }]);
    stream.on("change", (change) => {
      if (change.operationType === "insert") this.emit(change.fullDocument);
    });
    // Clusters without change stream support report it here, asynchronously.
    stream.on("error", (error) => {
      console.warn(`[store] change stream unavailable, polling instead: ${error.message}`);
      void stream.close();
      this.stopWatching = null;
      this.startPolling();
    });
    this.stopWatching = () => stream.close();
    this.delivery = "change stream";
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.delivery = "polling";
    this.pollTimer = setInterval(async () => {
      try {
        const docs = await this.events
          .find(this.lastSeenId ? { _id: { $gt: this.lastSeenId } } : {})
          .sort({ _id: 1 })
          .limit(500)
          .toArray();
        for (const doc of docs) this.emit(doc);
      } catch (error) {
        console.warn(`[store] poll failed: ${(error as Error).message}`);
      }
    }, 750);
  }

  async close() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.stopWatching?.();
    await this.client.close();
  }
}

export async function openStore(): Promise<EventStore> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return new MemoryStore();
  return MongoStore.connect(uri, process.env.MONGODB_DB ?? "context_plane");
}
