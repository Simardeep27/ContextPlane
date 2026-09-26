import type { Db } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';

/**
 * Heartbeat time series (issue #55). Liveness samples only: never evidence, never an
 * authorization source. The coordination ledger keeps the durable report; this
 * collection is a bounded, expiring copy shaped for per-hour aggregation.
 */
export const HEARTBEAT_COLLECTION = 'cp_agent_heartbeats';
export const HEARTBEAT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** createCollection options for the time-series collection (used by scripts/atlas/create-timeseries.mjs). */
export const heartbeatCollectionOptions = {
  timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'minutes' },
  expireAfterSeconds: HEARTBEAT_TTL_SECONDS,
} as const;

/** Secondary index for per-scope, per-identity reads. */
export const heartbeatIndexes = [
  { key: { 'meta.orgId': 1, 'meta.projectId': 1, 'meta.scope': 1, 'meta.identity': 1, ts: -1 }, name: 'scope_identity_ts' },
] as const;

export interface HeartbeatMeta {
  readonly identity: string;
  readonly scope: string;
  readonly orgId: string;
  readonly projectId: string;
}
export interface HeartbeatDocument {
  readonly ts: Date;
  readonly meta: HeartbeatMeta;
  readonly status: string | null;
  readonly instanceId: string | null;
}
export interface HourlyHeartbeats { readonly hour: string; readonly identity: string; readonly reports: number }

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null;

function parse(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** A coordination message body is a heartbeat when it parses to `{ type: 'heartbeat' }`. */
export function isHeartbeatBody(body: string): boolean {
  return parse(body)?.type === 'heartbeat';
}

/** Build the time-series document. Only allowlisted fields; summaries and files are never copied. */
export function heartbeatDocument(input: { identity: string; coordinationScope: string; scope: ProjectScope; body: string;
  now?: Date }): HeartbeatDocument {
  const body = parse(input.body) ?? {};
  const reported = text(body.heartbeatAt, 64) ?? text(body.occurredAt, 64);
  const ts = reported && Number.isFinite(Date.parse(reported)) ? new Date(reported) : (input.now ?? new Date());
  return { ts, meta: { identity: input.identity.slice(0, 256), scope: input.coordinationScope.slice(0, 256),
    orgId: input.scope.orgId, projectId: input.scope.projectId },
  status: text(body.status, 32), instanceId: text(body.instanceId, 256) };
}

/** Best-effort write: a failed or missing time-series collection never fails the coordination call. */
export async function recordHeartbeat(db: Db, document: HeartbeatDocument): Promise<boolean> {
  try { await db.collection<HeartbeatDocument>(HEARTBEAT_COLLECTION).insertOne({ ...document }); return true; }
  catch { return false; }
}

/** Heartbeat reports per UTC hour and identity since `since`, oldest hour first. */
export async function hourlyHeartbeats(db: Db, scope: ProjectScope, coordinationScope: string, since: Date,
  limit = 500): Promise<HourlyHeartbeats[]> {
  const rows = await db.collection(HEARTBEAT_COLLECTION).aggregate<{ _id: { hour: Date; identity: string }; reports: number }>([
    { $match: { 'meta.orgId': scope.orgId, 'meta.projectId': scope.projectId, 'meta.scope': coordinationScope, ts: { $gte: since } } },
    { $group: { _id: { hour: { $dateTrunc: { date: '$ts', unit: 'hour' } }, identity: '$meta.identity' }, reports: { $sum: 1 } } },
    { $sort: { '_id.hour': 1, '_id.identity': 1 } },
    { $limit: limit },
  ]).toArray();
  return rows.map(row => ({ hour: row._id.hour.toISOString(), identity: row._id.identity, reports: row.reports }));
}

/**
 * Sink for coordinationHandlers' optional third argument. Wiring (deferred to avoid a
 * concurrent main.ts edit): `coordinationHandlers(coordinationRepository, brainRepository,
 * mongoHeartbeatSink(async () => (await connection()).client.db(database), scope))`.
 */
export function mongoHeartbeatSink(db: () => Promise<Db>, scope: ProjectScope) {
  return async (input: { identity: string; coordinationScope: string; body: string }): Promise<boolean> =>
    recordHeartbeat(await db(), heartbeatDocument({ ...input, scope }));
}
