import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoClient } from 'mongodb';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProjectScope } from '@context-plane/contracts';
import { createApp } from '../src/app.js';
import { MemoryCoordinationRepository } from '../src/coordination.js';
import { brainHandlers, coordinationHandlers, implementedTools } from '../src/domain.js';
import { MemoryBrainRepository, MongoBrainRepository, mayWritePrinciple, type BrainRepository } from '../src/brain.js';

const scope = 'project:context-plane';
const projectScope = { orgId: 'org_test', projectId: 'project_test' } as ProjectScope;
const token = 'brain-test-token-at-least-16';
const insight = { scope, kind: 'insight' as const, title: 'Lease retries', body: 'Acknowledge with the returned lease generation.',
  sourceIds: ['message-1'], author: 'codex:worker' };

async function contract(repository: BrainRepository, advance: () => void) {
  const first = await repository.remember({ ...insight, entryId: 'insight:lease' });
  assert.equal(first.created, true);
  assert.equal(first.entry.status, 'active');
  const replay = await repository.remember({ ...insight, entryId: 'insight:lease' });
  assert.equal(replay.created, false);
  assert.deepEqual(replay.entry, first.entry);
  await assert.rejects(repository.remember({ ...insight, entryId: 'insight:lease', body: 'Changed meaning.' }),
    { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(repository.remember({ ...insight, body: 'x'.repeat(4097) }), { code: 'INVALID_INPUT' });
  await assert.rejects(repository.remember({ ...insight, kind: 'principle' }), { code: 'FORBIDDEN' });
  advance();
  await repository.remember({ ...insight, kind: 'principle', author: 'simar:primary', entryId: 'principle:verified',
    title: 'Verified over reported', body: 'A report is evidence of communication, not proof.' });
  advance();
  await repository.remember({ ...insight, entryId: 'insight:other', title: 'Surfaces', body: 'Keep one work-status surface.' });
  // Query ranks the matching entry; unmatched entries are excluded.
  assert.deepEqual((await repository.recall(scope, { query: 'lease generation', limit: 10 })).map(e => e.entryId), ['insight:lease']);
  // No query: recency ordering, kind filter, scope isolation.
  assert.deepEqual((await repository.recall(scope, { kinds: ['insight'], limit: 10 })).map(e => e.entryId),
    ['insight:other', 'insight:lease']);
  assert.deepEqual(await repository.recall('project:elsewhere', { limit: 10 }), []);
  // Correction supersedes; the original stays stored but is no longer active.
  advance();
  await repository.remember({ ...insight, entryId: 'insight:lease-v2', supersedes: 'insight:lease',
    body: 'Acknowledge only with the returned lease generation, after doing the work.' });
  const active = (await repository.recall(scope, { kinds: ['insight'], limit: 10 })).map(e => e.entryId);
  assert.deepEqual(active, ['insight:lease-v2', 'insight:other']);
  // Retirement is also a new immutable entry.
  advance();
  await repository.remember({ ...insight, entryId: 'insight:other-retired', supersedes: 'insight:other', status: 'retired',
    title: 'Retired', body: 'No longer applies.' });
  assert.deepEqual((await repository.recall(scope, { kinds: ['insight'], limit: 10 })).map(e => e.entryId), ['insight:lease-v2']);
  assert.equal((await repository.listByPrefix(scope, 'insight:lease', 10)).length, 2);
}

it('restricts principles to human:* or *:primary identities', () => {
  for (const identity of ['shivraj:primary', 'human:buddhsen']) assert.equal(mayWritePrinciple(identity), true);
  for (const identity of ['shivraj:sync', 'steward:context', 'primary', 'a:b:primary']) assert.equal(mayWritePrinciple(identity), false);
});

it('memory brain store is immutable, idempotent, and ranks active entries', async () => {
  let now = new Date('2026-09-26T16:00:00Z');
  await contract(new MemoryBrainRepository(() => now), () => { now = new Date(now.getTime() + 60_000); });
});

it('Mongo brain store matches the contract (opt-in: CONTEXT_PLANE_TEST_MONGODB_URI)', { skip: !process.env.CONTEXT_PLANE_TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.CONTEXT_PLANE_TEST_MONGODB_URI!, { serverSelectionTimeoutMS: 5000 });
  const database = `cp_brain_test_${process.pid}_${Date.now()}`;
  try {
    const db = client.db(database);
    let now = new Date('2026-09-26T16:00:00Z');
    const repository = new MongoBrainRepository(db, projectScope, () => now);
    await repository.initialize();
    await contract(repository, () => { now = new Date(now.getTime() + 60_000); });
    const indexes = (await db.collection('cp_brain_entries').indexes()).map(index => index.name).sort();
    assert.deepEqual(indexes, ['_id_', 'recall', 'scope_entry', 'supersedes']);
  } finally {
    await client.db(database).dropDatabase().catch(() => {});
    await client.close();
  }
});

it('MCP remember/recall enforce scope and registration and extend get_context with a bounded digest', async () => {
  const coordination = new MemoryCoordinationRepository();
  const brain = new MemoryBrainRepository();
  const app = createApp({ token, ready: async () => {},
    principal: { scope: projectScope, coordinationScope: scope, identity: 'test', allowedTools: implementedTools },
    handlers: { ...coordinationHandlers(async () => coordination, async () => brain),
      ...brainHandlers(async () => coordination, async () => brain) } });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const client = new Client({ name: 'brain-test', version: '1.0.0' });
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const raw = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await raw(name, args);
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  };
  const errorOf = async (name: string, args: Record<string, unknown>) =>
    (((await raw(name, args)).content as Array<{ text: string }>)[0]!.text);
  try {
    await client.connect(transport as unknown as Transport);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes('remember') && names.includes('recall'));
    const entry = { identity: 'shivraj:primary', scope, kind: 'principle', title: 'Never write as another person',
      body: 'Use only your assigned identity.', source_ids: ['docs/AGENT_SYNC_CONTRACT.md'] };
    assert.equal(await errorOf('remember', entry), 'NOT_FOUND');
    await call('register_agent', { identity: 'shivraj:primary', scope });
    await call('register_agent', { identity: 'shivraj:sync', scope });
    assert.equal(await errorOf('remember', { ...entry, scope: 'project:elsewhere' }), 'INVALID_INPUT');
    assert.equal(await errorOf('remember', { ...entry, identity: 'shivraj:sync' }), 'FORBIDDEN');
    assert.equal(await errorOf('remember', { ...entry, kind: 'rumor' }), 'INVALID_INPUT');
    const stored = await call('remember', { ...entry, entry_id: 'principle:identity' });
    assert.equal(stored.author, 'shivraj:primary');
    assert.deepEqual(await call('remember', { ...entry, entry_id: 'principle:identity' }), stored);
    for (let index = 0; index < 8; index++) {
      await call('remember', { identity: 'shivraj:sync', scope, kind: 'insight', title: `Insight ${index}`,
        body: 'y'.repeat(4000), source_ids: [`message-${index}`], entry_id: `insight:${index}` });
    }
    const recalled = await call('recall', { identity: 'shivraj:sync', scope, query: 'assigned identity', limit: 5 });
    assert.deepEqual(recalled.entries.map((item: { entryId: string }) => item.entryId), ['principle:identity']);
    assert.equal(await errorOf('recall', { identity: 'unregistered', scope }), 'NOT_FOUND');
    const context = await call('get_context', { identity: 'shivraj:sync', scope });
    assert.equal(context.context.agent.identity, 'shivraj:sync');
    assert.deepEqual(context.brain.principles.map((item: { entryId: string }) => item.entryId), ['principle:identity']);
    assert.equal(context.brain.insights.length, 5);
    assert.ok(context.brain.insights.every((item: { body: string }) => item.body.length <= 1025));
    await call('send_message', { identity: 'shivraj:sync', scope, message_id: 'ledger-1', recipient: 'shivraj:primary',
      body: JSON.stringify({ type: 'progress', summary: 'Added brain', files: ['packages/mcp'] }), evidence_ids: ['PRIVATE'] });
    const ledger = await call('read_ledger', { identity: 'shivraj:ui', scope, limit: 200 });
    assert.deepEqual(ledger.events.map((event: { type: string }) => event.type), ['progress']);
    assert.ok(!JSON.stringify(ledger).includes('PRIVATE'));
    assert.equal(await errorOf('read_ledger', { identity: 'shivraj:ui', scope: 'project:elsewhere' }), 'INVALID_INPUT');
    assert.equal(await errorOf('read_ledger', { identity: 'shivraj:ui', scope, limit: 201 }), 'INVALID_INPUT');
    assert.equal(await errorOf('read_ledger', { identity: 'shivraj:ui', scope, since: '2026-13-99Tjunk' }), 'INVALID_INPUT');
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  }
});
