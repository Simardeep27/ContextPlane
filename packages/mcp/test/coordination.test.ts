import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MongoServerError, type Db } from 'mongodb';
import type { ProjectScope } from '@context-plane/contracts';
import { MemoryCoordinationRepository, MongoCoordinationRepository } from '../src/coordination.js';

const coordinationScope = 'project:context-plane';
const scope = { orgId: 'org_test', projectId: 'project_test' } as ProjectScope;
const message = { coordinationScope, messageId: 'message-1', senderIdentity: 'agent:a',
  recipientIdentity: 'agent:b', body: 'Please verify.', evidenceIds: ['evidence-1'] };
const dependency = { coordinationScope, dependencyId: 'dependency-1', ownerIdentity: 'agent:a',
  dependsOn: 'agent:b', description: 'Integration verification.' };

it('fences expired leases and stale generations while making exact acknowledgements retryable', async () => {
  let now = new Date('2026-09-26T16:00:00Z');
  const repository = new MemoryCoordinationRepository(() => now);
  await repository.sendMessage(message);
  const first = (await repository.receiveInbox('agent:b', coordinationScope, 1, 10))[0]!;
  now = new Date(now.getTime() + 10_000);
  await assert.rejects(repository.acknowledge('agent:b', coordinationScope, message.messageId, first.leaseGeneration, true), { code: 'LEASE_LOST' });
  const second = (await repository.receiveInbox('agent:b', coordinationScope, 1, 10))[0]!;
  assert.equal(second.leaseGeneration, 2);
  for (const [identity, group, generation] of [
    ['agent:b', coordinationScope, 1], ['agent:a', coordinationScope, 2], ['agent:b', 'other-scope', 2],
  ] as const) {
    await assert.rejects(repository.acknowledge(identity, group, message.messageId, generation, true), { code: 'LEASE_LOST' });
  }
  const acknowledged = await repository.acknowledge('agent:b', coordinationScope, message.messageId, 2, true);
  assert.deepEqual(await repository.acknowledge('agent:b', coordinationScope, message.messageId, 2, true), acknowledged);
  assert.deepEqual(await repository.sendMessage(message), acknowledged);
  assert.deepEqual(await repository.receiveInbox('agent:b', coordinationScope, 10, 10), []);
  await assert.rejects(repository.sendMessage({ ...message, body: 'Conflicting retry.' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

it('keeps colon-containing owner/surface tuples distinct and preserves dependency ownership', async () => {
  const repository = new MemoryCoordinationRepository();
  for (const identity of ['agent:a', 'agent']) await repository.registerAgent({ identity, coordinationScope, metadata: {} });
  await repository.publishSurface({ coordinationScope, ownerIdentity: 'agent:a', surfaceName: 'work', kind: 'status', content: 'first' });
  await repository.publishSurface({ coordinationScope, ownerIdentity: 'agent', surfaceName: 'a:work', kind: 'status', content: 'second' });
  const context = await repository.getContext('agent:a', coordinationScope);
  assert.equal(context?.surfaces.length, 2);
  assert.deepEqual(context?.surfaces.map(surface => surface.content), ['first', 'second']);
  await repository.registerDependency(dependency);
  await assert.rejects(repository.registerDependency({ ...dependency, ownerIdentity: 'agent:b' }), { code: 'CONFLICT' });
  assert.equal((await repository.getContext('agent:a', coordinationScope))?.dependencies[0]?.ownerIdentity, 'agent:a');
  assert.equal(await repository.getContext('agent:a', 'other-scope'), null);
});

it('bounds leased inbox responses without hiding the remaining pending messages', async () => {
  const repository = new MemoryCoordinationRepository();
  for (let index = 0; index < 20; index++) await repository.sendMessage({ ...message, messageId: `large-${index}`,
    body: 'x'.repeat(8000), evidenceIds: Array.from({ length: 70 }, (_, item) => `${item}-${'e'.repeat(250)}`) });
  const first = await repository.receiveInbox('agent:b', coordinationScope, 20, 60);
  assert.ok(first.length > 0 && first.length < 20);
  assert.ok(Buffer.byteLength(JSON.stringify({ messages: first })) < 128 * 1024);
  const second = await repository.receiveInbox('agent:b', coordinationScope, 20, 60);
  assert.ok(second.length > 0);
  assert.ok(second.every(item => !first.some(previous => previous.messageId === item.messageId)));
});

it('Mongo dependency compare-and-swap rejects a lost update and fenced first-create race', async () => {
  let existing: Record<string, unknown> | null = { _id: 'existing', orgId: scope.orgId, projectId: scope.projectId,
    ...dependency, description: 'Previous version.', revision: 3, updatedAt: '2026-09-26T16:00:00Z' };
  const collection = {
    findOne: async () => existing,
    replaceOne: async (filter: Record<string, unknown>) => {
      if (existing) {
        assert.equal(filter.revision, 3);
        return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
      }
      assert.deepEqual(filter.revision, { $exists: false });
      throw new MongoServerError({ code: 11000, message: 'Simulated concurrent insert.' });
    },
  };
  const repository = new MongoCoordinationRepository({ collection: () => collection } as unknown as Db, scope);
  await assert.rejects(repository.registerDependency(dependency), { code: 'CONFLICT' });
  existing = null;
  await assert.rejects(repository.registerDependency(dependency), { code: 'CONFLICT' });
});

it('Mongo simultaneous identical sends reconcile the winning record and reject changed retries', async () => {
  let stored: Record<string, unknown> | null = null;
  const collection = {
    findOne: async () => stored,
    insertOne: async (value: Record<string, unknown>) => {
      stored = structuredClone(value);
      throw new MongoServerError({ code: 11000, message: 'Simulated concurrent insert.' });
    },
  };
  const repository = new MongoCoordinationRepository({ collection: () => collection } as unknown as Db, scope);
  const sent = await repository.sendMessage(message);
  assert.equal(sent.messageId, message.messageId);
  assert.deepEqual(await repository.sendMessage(message), sent);
  await assert.rejects(repository.sendMessage({ ...message, recipientIdentity: 'other' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

it('Mongo acknowledgement requires a live lease and preserves its generation on retries', async () => {
  const collection = {
    findOneAndUpdate: async (filter: Record<string, unknown>) => {
      assert.equal(filter.leaseGeneration, 2);
      assert.ok(typeof (filter.leaseExpiresAt as { $gt: unknown }).$gt === 'string');
      return null;
    },
    findOne: async (filter: Record<string, unknown>) => {
      assert.equal(filter.recipientIdentity, 'agent:b');
      assert.equal(filter.leaseGeneration, 2);
      assert.equal(filter.status, 'acknowledged');
      return null;
    },
  };
  const repository = new MongoCoordinationRepository({ collection: () => collection } as unknown as Db, scope);
  await assert.rejects(repository.acknowledge('agent:b', coordinationScope, message.messageId, 2, true), { code: 'LEASE_LOST' });
});
