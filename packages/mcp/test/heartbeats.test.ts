import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';
import { MemoryCoordinationRepository } from '../src/coordination.js';
import { coordinationHandlers, implementedTools } from '../src/domain.js';
import { HEARTBEAT_COLLECTION, HEARTBEAT_TTL_SECONDS, heartbeatCollectionOptions, heartbeatDocument, heartbeatIndexes,
  hourlyHeartbeats, isHeartbeatBody, mongoHeartbeatSink } from '../src/heartbeats.js';

const scope = { orgId: 'org_test', projectId: 'project_test' } as ProjectScope;
const coordinationScope = 'project:context-plane';
const heartbeat = (at: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'heartbeat', actor: 'simar:primary',
  instanceId: 'inst-a', status: 'working', heartbeatAt: at, summary: 'secret-ish summary', files: ['a.ts'], ...extra });

it('time-series options: ts/meta, minute granularity, 7-day expiry', () => {
  assert.equal(HEARTBEAT_COLLECTION, 'cp_agent_heartbeats');
  assert.deepEqual(heartbeatCollectionOptions, { timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'minutes' },
    expireAfterSeconds: 604_800 });
  assert.equal(HEARTBEAT_TTL_SECONDS, 7 * 86_400);
  assert.equal(heartbeatIndexes[0]!.name, 'scope_identity_ts');
});

it('heartbeat document carries only allowlisted fields with a Date timeField', () => {
  const doc = heartbeatDocument({ identity: 'simar:primary', coordinationScope, scope, body: heartbeat('2026-09-26T10:05:00Z') });
  assert.deepEqual(doc, { ts: new Date('2026-09-26T10:05:00Z'),
    meta: { identity: 'simar:primary', scope: coordinationScope, orgId: 'org_test', projectId: 'project_test' },
    status: 'working', instanceId: 'inst-a' });
  const fallback = heartbeatDocument({ identity: 'x', coordinationScope, scope, body: 'not json', now: new Date(0) });
  assert.equal(fallback.ts.getTime(), 0);
  assert.equal(isHeartbeatBody(heartbeat('2026-09-26T10:05:00Z')), true);
  assert.equal(isHeartbeatBody(JSON.stringify({ type: 'progress' })), false);
  assert.equal(isHeartbeatBody('free text'), false);
});

it('send_message records heartbeats best-effort and never fails on sink errors', async () => {
  const coordination = new MemoryCoordinationRepository();
  const seen: string[] = [];
  const principal = { scope, coordinationScope, identity: 'test', allowedTools: implementedTools };
  for (const failing of [false, true]) {
    const handlers = coordinationHandlers(async () => coordination, undefined, async input => {
      if (failing) throw new Error('down'); seen.push(input.identity);
    });
    for (const identity of ['a:primary', 'b:primary']) await handlers.register_agent!.execute(principal, { identity, scope: coordinationScope });
    const send = (id: string, body: string) => handlers.send_message!.execute(principal,
      { identity: 'a:primary', scope: coordinationScope, message_id: `${failing}:${id}`, recipient: 'b:primary', body });
    await send('hb', heartbeat('2026-09-26T10:05:00Z'));
    await send('progress', JSON.stringify({ type: 'progress' }));
  }
  assert.deepEqual(seen, ['a:primary']);
});

it('Mongo time series aggregates heartbeats per hour (opt-in: CONTEXT_PLANE_TEST_MONGODB_URI)', { skip: !process.env.CONTEXT_PLANE_TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.CONTEXT_PLANE_TEST_MONGODB_URI!, { serverSelectionTimeoutMS: 5000 });
  const db = client.db(`cp_heartbeats_${randomUUID().slice(0, 8)}`);
  try {
    await db.createCollection(HEARTBEAT_COLLECTION, { ...heartbeatCollectionOptions });
    const info = (await db.listCollections({ name: HEARTBEAT_COLLECTION }).toArray())[0] as { type: string; options: Record<string, unknown> };
    assert.equal(info.type, 'timeseries');
    assert.equal(info.options.expireAfterSeconds, HEARTBEAT_TTL_SECONDS);
    const sink = mongoHeartbeatSink(async () => db, scope);
    for (const at of ['2026-09-26T10:01:00Z', '2026-09-26T10:30:00Z', '2026-09-26T11:02:00Z']) {
      assert.equal(await sink({ identity: 'simar:primary', coordinationScope, body: heartbeat(at) }), true);
    }
    assert.deepEqual(await hourlyHeartbeats(db, scope, coordinationScope, new Date('2026-09-26T00:00:00Z')), [
      { hour: '2026-09-26T10:00:00.000Z', identity: 'simar:primary', reports: 2 },
      { hour: '2026-09-26T11:00:00.000Z', identity: 'simar:primary', reports: 1 }]);
  } finally { await db.dropDatabase(); await client.close(); }
});
