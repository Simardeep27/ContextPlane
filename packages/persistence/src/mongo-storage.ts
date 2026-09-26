import { MongoClient, MongoServerError, type Db } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';
import type { CollectionKind, ResettableStorage, StorageTransaction } from './storage.js';
import { identifier, requireThat, sanitized, scopedKey } from './validation.js';

interface Row {
  _id: string;
  orgId: string;
  projectId: string;
  key: string;
  value?: unknown;
  cursor?: number;
  lockVersion?: number;
  clock?: Date;
}
const kinds: readonly CollectionKind[] = ['projects', 'runs', 'events', 'receipts', 'records'];

export class MongoStorage implements ResettableStorage {
  constructor(private readonly client: MongoClient, private readonly db: Db) {}
  private collection(kind: CollectionKind) {
    return this.db.collection<Row>('cp_' + kind, { readConcern: { level: 'majority' }, readPreference: 'primary',
      writeConcern: { w: 'majority' } });
  }
  async initialize(): Promise<void> {
    await sanitized(async () => {
      for (const kind of kinds) await this.collection(kind).createIndex({ orgId: 1, projectId: 1, key: 1 },
        { unique: true, name: 'scope_key' });
      await this.collection('events').createIndex({ orgId: 1, projectId: 1, cursor: 1 },
        { unique: true, name: 'scope_cursor' });
    });
  }
  async transaction<T>(scope: ProjectScope, action: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const _id = scopedKey(scope, 'state');
    return sanitized(async () => {
      for (let attempt = 0; ; attempt++) {
        const session = this.client.startSession();
        try {
          return await session.withTransaction(async () => {
            // Serialize bounded writes within ONE project. Writing the same
            // guard for claims, renewals and effects closes lease-check races
            // and prevents a later SSE cursor committing before an earlier one.
            const guard = await this.collection('projects').findOneAndUpdate({ _id }, [{ $set: {
              orgId: { $literal: scope.orgId }, projectId: { $literal: scope.projectId }, key: 'state',
              lockVersion: { $add: [{ $ifNull: ['$lockVersion', 0] }, 1] }, clock: '$$NOW',
            } }], { upsert: true, session, returnDocument: 'after' });
            requireThat(guard?.clock, 'CONFLICT');
            const tx: StorageTransaction = { now: guard.clock,
              get: async <V>(kind: CollectionKind, key: string) => {
                const row = await this.collection(kind).findOne({ _id: scopedKey(scope, key) }, { session });
                return (row?.value as V) ?? null;
              },
              put: async (kind, key, value, cursor) => {
                await this.collection(kind).updateOne({ _id: scopedKey(scope, key) }, { $set: {
                  orgId: scope.orgId, projectId: scope.projectId, key, value,
                  ...(cursor === undefined ? {} : { cursor }),
                } }, { upsert: true, session });
              },
            };
            return action(tx);
          }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
            // No external effects in callbacks. Bound this small POC transaction.
            timeoutMS: 15_000 });
        } catch (error) {
          // First creation of a project guard can race with another process.
          if (!(error instanceof MongoServerError && error.code === 11000 && attempt < 2)) throw error;
        } finally { await session.endSession(); }
      }
    });
  }
  async read<T>(scope: ProjectScope, kind: CollectionKind, key: string): Promise<T | null> {
    const _id = scopedKey(scope, key);
    return sanitized(async () => (await this.collection(kind).findOne({ _id }))?.value as T ?? null);
  }
  async events<T>(scope: ProjectScope, after: number, limit: number): Promise<T[]> {
    scopedKey(scope, 'state');
    return sanitized(async () => (await this.collection('events').find({ orgId: scope.orgId,
      projectId: scope.projectId, cursor: { $gt: after } }).sort({ cursor: 1 }).limit(limit).toArray()).map(row => row.value as T));
  }
  async deleteScope(scope: ProjectScope): Promise<void> {
    scopedKey(scope, 'state');
    await sanitized(async () => {
      for (const kind of kinds) await this.collection(kind).deleteMany({ orgId: scope.orgId, projectId: scope.projectId });
    });
  }
  async list<T>(scope: ProjectScope, kind: CollectionKind, keyPrefix: string, limit: number): Promise<T[]> {
    scopedKey(scope, 'state');
    // Anchored prefix on the indexed (orgId, projectId, key) tuple.
    return sanitized(async () => (await this.collection(kind).find({ orgId: scope.orgId, projectId: scope.projectId,
      key: { $regex: '^' + escapeRegex(keyPrefix) } }).sort({ key: 1 }).limit(limit).toArray()).map(row => row.value as T));
  }
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function connectStorage(database: string, uri = process.env.MONGODB_URI) {
  identifier(database); requireThat(uri && /^mongodb(?:\+srv)?:\/\//.test(uri));
  return sanitized(async () => {
    // Long-running local API/worker: reuse one pool; keep driver pool defaults
    // until concurrency is measured. These timeouts bound short POC operations.
    const client = new MongoClient(uri, { appName: 'context-plane-persistence',
      serverSelectionTimeoutMS: 10_000, timeoutMS: 15_000 });
    try {
      await client.connect(); await client.db(database).command({ ping: 1 });
      return { client, storage: new MongoStorage(client, client.db(database)), close: () => client.close() };
    } catch (error) { await client.close(); throw error; }
  });
}
