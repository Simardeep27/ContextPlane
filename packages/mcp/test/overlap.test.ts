import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProjectScope } from '@context-plane/contracts';
import { createApp } from '../src/app.js';
import { MemoryCoordinationRepository } from '../src/coordination.js';
import { coordinationHandlers, implementedTools, overlapHandlers } from '../src/domain.js';
import {
  COLLISION_THRESHOLD, EMBEDDING_DIMENSIONS, lexicalSimilarity, MemoryWorkEmbeddingStore, MongoWorkEmbeddingStore,
  OverlapService, VoyageEmbedder, workFromMessage, workFromSurface, type Embedder, type WorkRecord,
} from '../src/overlap.js';

const scope = 'project:context-plane';
const projectScope = { orgId: 'org_overlap', projectId: 'project_overlap' } as ProjectScope;
const token = 'overlap-test-token-at-least-16';
const clock = () => new Date('2026-09-26T16:00:00.000Z');
const record = (identity: string, task: string, extra: Partial<WorkRecord> = {}): WorkRecord => ({ scope, identity, task,
  status: 'working', files: [], citations: [`message:${identity}:1`], source: 'work_started', updatedAt: clock().toISOString(), ...extra });

/** Fake embedder: axis-aligned vectors chosen per keyword so cosine similarity is exact. */
function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return { model: 'fake', embed: async text => {
    const key = Object.keys(table).find(word => text.includes(word));
    if (!key) throw new Error('UNKNOWN_TEXT');
    return table[key]!;
  } };
}
const unit = (angle: number) => [Math.cos(angle), Math.sin(angle)];

it('lexical fallback is deterministic, excludes the caller and flags only at the 0.82 threshold', async () => {
  const store = new MemoryWorkEmbeddingStore();
  await store.upsert(record('simar:primary', 'Build the MVP-02 migration import pipeline'));
  await store.upsert(record('buddh:primary', 'Write HQ dashboard styles'));
  await store.upsert(record('shivraj:primary', 'Build the MVP-02 migration import pipeline'));
  const service = new OverlapService(store, undefined, clock);
  const result = await service.check(scope, 'shivraj:primary', 'build the mvp-02 migration import pipeline', []);
  assert.equal(result.method, 'lexical'); assert.equal(result.fallbackReason, 'NO_EMBEDDING_KEY');
  assert.equal(result.threshold, COLLISION_THRESHOLD); assert.equal(result.collision, true);
  assert.deepEqual(result.matches.map(match => match.identity), ['simar:primary']);
  assert.equal(result.matches[0]!.similarity, 1);
  assert.deepEqual(result.matches[0]!.citations, ['message:simar:primary:1']);
  assert.deepEqual(await service.check(scope, 'shivraj:primary', 'build the mvp-02 migration import pipeline'), result);
  // 4 of 5 shared tokens -> 0.8 Jaccard: close, but below the collision threshold.
  assert.equal(lexicalSimilarity('alpha beta gamma delta', 'alpha beta gamma delta epsilon'), 0.8);
  const near = await service.check(scope, 'buddh:primary', 'Build the MVP-02 import', []);
  assert.equal(near.collision, false); assert.ok(near.matches[0]!.similarity < COLLISION_THRESHOLD);
  assert.deepEqual((await service.check('project:elsewhere', 'x:primary', 'Build the MVP-02 migration')).matches, []);
});

it('vector path uses the search seam, applies the threshold on cosine and falls back when search is unavailable', async () => {
  const embedder = fakeEmbedder({ ingest: unit(0), import: unit(0.5), styles: unit(Math.PI / 2), mine: unit(0) });
  const store = new MemoryWorkEmbeddingStore();
  await store.upsert(record('simar:primary', 'ingest pipeline', { embedding: unit(0.5) }));
  await store.upsert(record('buddh:primary', 'hq styles', { embedding: unit(Math.PI / 2) }));
  await store.upsert(record('shivraj:primary', 'mine', { embedding: unit(0) }));
  const service = new OverlapService(store, embedder, clock);
  const collide = await service.check(scope, 'shivraj:primary', 'ingest', ['packages/x']);
  assert.equal(collide.method, 'vector');
  assert.deepEqual(collide.matches.map(match => match.identity), ['simar:primary', 'buddh:primary']);
  assert.equal(collide.matches[0]!.similarity, Math.round(Math.cos(0.5) * 10_000) / 10_000); // 0.8776 >= 0.82
  assert.equal(collide.matches[0]!.collision, true); assert.equal(collide.matches[1]!.collision, false);
  // cos(0.7) = 0.7648: semantically near, but not a collision.
  await store.upsert(record('simar:primary', 'ingest pipeline', { embedding: unit(0.7) }));
  const below = await service.check(scope, 'shivraj:primary', 'ingest');
  assert.equal(below.collision, false);
  const offline = new OverlapService(new MemoryWorkEmbeddingStore(false), embedder, clock);
  await offline.recordInBackground(record('simar:primary', 'ingest pipeline')); await offline.settled();
  const fallback = await offline.check(scope, 'shivraj:primary', 'ingest pipeline');
  assert.equal(fallback.method, 'lexical'); assert.equal(fallback.fallbackReason, 'VECTOR_SEARCH_UNAVAILABLE');
  assert.equal(fallback.collision, true);
});

it('extracts work only from work-status surfaces and work_started reports', () => {
  assert.equal(workFromSurface('a', scope, 'notes', 'team-context', { task: 'x' }, 1), null);
  assert.equal(workFromSurface('a', scope, 'work-status', 'team-context', { status: 'done' }, 1), null);
  const surface = workFromSurface('a', scope, 'work-status', 'team-context',
    { task: 'Issue #53', currentTask: 'vector search', status: 'working', files: ['a.ts', 7], lastEventId: 'a:1' }, 3);
  assert.deepEqual(surface, { scope, identity: 'a', task: 'Issue #53 — vector search', status: 'working', files: ['a.ts'],
    source: 'work-status', citations: ['surface:a/work-status@3', 'message:a:1'] });
  assert.ok(workFromSurface('a', scope, 'current', 'work-status', { task: 'x' }, 1));
  assert.equal(workFromMessage('a', scope, 'm', 'free text'), null);
  assert.equal(workFromMessage('a', scope, 'm', JSON.stringify({ type: 'progress', task: 'x' })), null);
  assert.deepEqual(workFromMessage('a', scope, 'm', JSON.stringify({ type: 'work_started', task: 'x', files: ['f'] }))?.citations, ['message:m']);
});

it('Voyage embedder sends the configured model and dimensions and never leaks the key in errors', async () => {
  let sent: { url: string; body: Record<string, unknown>; auth: string } | undefined;
  const ok = new VoyageEmbedder('secret-key', 'voyage-3.5', (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).authorization };
    return new Response(JSON.stringify({ data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) }] }));
  }) as typeof fetch);
  assert.equal((await ok.embed('task', 'query')).length, EMBEDDING_DIMENSIONS);
  assert.equal(sent?.url, 'https://api.voyageai.com/v1/embeddings');
  assert.deepEqual(sent?.body, { input: ['task'], model: 'voyage-3.5', input_type: 'query', output_dimension: 1024 });
  const failing = new VoyageEmbedder('secret-key', 'voyage-3.5', (async () => new Response('no', { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(failing.embed('task', 'query'), (error: Error) => error.message === 'EMBEDDING_HTTP_401' && !error.message.includes('secret'));
});

it('MCP check_overlap is read-only, and embedding failures never fail publish_surface or send_message', async () => {
  const coordination = new MemoryCoordinationRepository(clock);
  const store = new MemoryWorkEmbeddingStore();
  const broken: Embedder = { model: 'broken', embed: async () => { throw new Error('VOYAGE_DOWN'); } };
  const overlap = new OverlapService(store, broken, clock);
  const failingStore = new OverlapService({ upsert: async () => { throw new Error('ATLAS_DOWN'); },
    vectorSearch: async () => [], list: async () => [] }, broken, clock);
  const start = (service: OverlapService) => {
    const app = createApp({ token, ready: async () => {},
      principal: { scope: projectScope, coordinationScope: scope, identity: 'test', allowedTools: implementedTools },
      handlers: { ...coordinationHandlers(async () => coordination, undefined, undefined, service),
        ...overlapHandlers(async () => coordination, service) } });
    return app.listen(0, '127.0.0.1');
  };
  for (const service of [overlap, failingStore]) {
    const server: Server = start(service);
    await new Promise(resolve => server.once('listening', resolve));
    const client = new Client({ name: 'overlap-test', version: '1.0.0' });
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    };
    try {
      await client.connect(transport as unknown as Transport);
      const tool = (await client.listTools()).tools.find(item => item.name === 'check_overlap');
      assert.equal(tool?.annotations?.readOnlyHint, true);
      for (const identity of ['simar:primary', 'shivraj:primary']) await call('register_agent', { identity, scope });
      await call('publish_surface', { identity: 'simar:primary', scope, surface_name: 'work-status', kind: 'team-context',
        content: { task: 'Atlas vector search duplicate work detection', status: 'working', files: ['packages/mcp/src/overlap.ts'] } });
      await call('send_message', { identity: 'shivraj:primary', scope, message_id: 'shivraj:1', recipient: 'simar:primary',
        body: JSON.stringify({ type: 'work_started', task: 'HQ team view polish' }) });
      await service.settled();
      const result = await call('check_overlap', { identity: 'shivraj:primary', scope,
        task_text: 'Atlas vector search duplicate work detection', files: ['packages/mcp/src/overlap.ts'] });
      if (service === overlap) {
        assert.equal(result.method, 'lexical'); assert.equal(result.fallbackReason, 'VECTOR_SEARCH_UNAVAILABLE');
        assert.equal(result.collision, true);
        assert.deepEqual(result.matches.map((match: { identity: string }) => match.identity), ['simar:primary']);
        assert.deepEqual(result.matches[0].sharedFiles, ['packages/mcp/src/overlap.ts']);
        assert.equal(store.records.size, 2);
        assert.ok([...store.records.values()].every(item => item.embedding === undefined));
      } else {
        assert.deepEqual(result.matches, []);
      }
      const unregistered = await client.callTool({ name: 'check_overlap', arguments: { identity: 'nobody', scope, task_text: 'x' } });
      assert.equal((unregistered.content as Array<{ text: string }>)[0]!.text, 'NOT_FOUND');
    } finally {
      await client.close(); await new Promise(resolve => server.close(resolve));
    }
  }
});

it('Mongo work store upserts one record per identity (opt-in: CONTEXT_PLANE_TEST_MONGODB_URI)', { skip: !process.env.CONTEXT_PLANE_TEST_MONGODB_URI }, async () => {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.CONTEXT_PLANE_TEST_MONGODB_URI!);
  const database = `cp_overlap_test_${process.pid}_${Date.now()}`;
  try {
    const db = client.db(database);
    const store = new MongoWorkEmbeddingStore(db, projectScope); await store.initialize();
    await store.upsert(record('simar:primary', 'first task', { embedding: [1, 0] , embeddingModel: 'fake' }));
    await store.upsert(record('simar:primary', 'second task'));
    await store.upsert(record('buddh:primary', 'other'));
    const listed = await store.list(scope, 10);
    assert.equal(listed.length, 2);
    const simar = listed.find(item => item.identity === 'simar:primary');
    assert.equal(simar?.task, 'second task'); assert.equal(simar?.embedding, undefined);
    assert.equal((await db.collection('cp_work_embeddings').findOne({ identity: 'simar:primary' }))?.embedding, undefined);
    assert.deepEqual(await store.list('project:elsewhere', 10), []);
    await assert.rejects(store.vectorSearch(scope, [1, 0], 'x', 5));
    const lexical = await new OverlapService(store).check(scope, 'buddh:primary', 'second task');
    assert.equal(lexical.method, 'lexical'); assert.equal(lexical.matches[0]?.identity, 'simar:primary');
  } finally {
    await client.db(database).dropDatabase(); await client.close();
  }
});
