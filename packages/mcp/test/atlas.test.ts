import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import type { ProjectScope } from '@context-plane/contracts';
import { connectStorage } from '@context-plane/persistence';
import { MongoCoordinationRepository } from '../src/coordination.js';

if (process.env.CONTEXT_PLANE_ATLAS_TESTS !== '1') {
  it('live coordination Atlas test requires CONTEXT_PLANE_ATLAS_TESTS=1 and MONGODB_URI', { skip: true }, () => {});
} else {
  const database = `cp_coordination_test_${randomUUID().replaceAll('-', '')}`;
  const scope = { orgId: 'org_coordination_test', projectId: 'project_coordination_test' } as ProjectScope;
  let cleanup: Awaited<ReturnType<typeof connectStorage>> | undefined;

  before(async () => { cleanup = await connectStorage(database); });
  after(async () => {
    if (!cleanup) return;
    try {
      assert.match(database, /^cp_coordination_test_[a-f0-9]{32}$/u);
      await cleanup.client.db(database).dropDatabase();
    } finally { await cleanup.close(); }
  });

  it('recovers registered context and retryable inbox state through a new Atlas connection', async () => {
    const first = await connectStorage(database);
    try {
      const repository = new MongoCoordinationRepository(first.client.db(database), scope);
      await repository.initialize();
      await repository.registerAgent({ identity: 'codex:nyny', coordinationScope: 'project:context-plane', metadata: {} });
      await repository.registerAgent({ identity: 'codex:peer', coordinationScope: 'project:context-plane', metadata: {} });
      await repository.publishSurface({ ownerIdentity: 'codex:nyny', coordinationScope: 'project:context-plane',
        surfaceName: 'codex-worklog', kind: 'work_status', content: { status: 'verified' } });
      await repository.sendMessage({ messageId: 'atlas-message-001', coordinationScope: 'project:context-plane',
        senderIdentity: 'codex:nyny', recipientIdentity: 'codex:peer', body: 'Verify Atlas recovery.', evidenceIds: [] });
    } finally { await first.close(); }

    const second = await connectStorage(database);
    try {
      const repository = new MongoCoordinationRepository(second.client.db(database), scope);
      await repository.initialize();
      const context = await repository.getContext('codex:nyny', 'project:context-plane');
      assert.equal(context?.surfaces[0]?.contentHash.length, 64);
      const inbox = await repository.receiveInbox('codex:peer', 'project:context-plane', 10, 60);
      assert.equal(inbox[0]?.messageId, 'atlas-message-001');
      assert.equal(inbox[0]?.leaseGeneration, 1);
      await repository.acknowledge('codex:peer', 'project:context-plane', 'atlas-message-001', 1, true);
      assert.deepEqual(await repository.receiveInbox('codex:peer', 'project:context-plane', 10, 60), []);
    } finally { await second.close(); }
  });

  it('reconciles simultaneous sends and fences expired or replaced leases in Mongo', async () => {
    const db = cleanup!.client.db(database);
    const repository = new MongoCoordinationRepository(db, scope);
    await repository.initialize();
    const message = { messageId: 'atlas-race-message', coordinationScope: 'project:context-plane',
      senderIdentity: 'race:sender', recipientIdentity: 'race:recipient', body: 'Concurrent retry.', evidenceIds: [] };
    const sends = await Promise.all([repository.sendMessage(message), repository.sendMessage(message)]);
    assert.deepEqual(sends[0], sends[1]);
    await assert.rejects(repository.sendMessage({ ...message, body: 'Conflicting retry.' }), { code: 'IDEMPOTENCY_CONFLICT' });
    const first = (await repository.receiveInbox(message.recipientIdentity, message.coordinationScope, 1, 60))[0]!;
    await db.collection('cp_coordination_messages').updateOne({ messageId: message.messageId }, {
      $set: { leaseExpiresAt: '2000-01-01T00:00:00.000Z' },
    });
    await assert.rejects(repository.acknowledge(message.recipientIdentity, message.coordinationScope,
      message.messageId, first.leaseGeneration, true), { code: 'LEASE_LOST' });
    const second = (await repository.receiveInbox(message.recipientIdentity, message.coordinationScope, 1, 60))[0]!;
    assert.equal(second.leaseGeneration, first.leaseGeneration + 1);
    await assert.rejects(repository.acknowledge(message.recipientIdentity, message.coordinationScope,
      message.messageId, first.leaseGeneration, true), { code: 'LEASE_LOST' });
    const result = await repository.acknowledge(message.recipientIdentity, message.coordinationScope,
      message.messageId, second.leaseGeneration, true);
    assert.deepEqual(await repository.acknowledge(message.recipientIdentity, message.coordinationScope,
      message.messageId, second.leaseGeneration, true), result);
    assert.deepEqual(await repository.receiveInbox(message.recipientIdentity, message.coordinationScope, 1, 60), []);
  });

  it('keeps colliding surface names and project scopes separate in Mongo', async () => {
    const db = cleanup!.client.db(database);
    const repository = new MongoCoordinationRepository(db, scope);
    const group = 'project:surface-isolation';
    await repository.registerAgent({ identity: 'agent:a', coordinationScope: group, metadata: {} });
    const first = { coordinationScope: group, ownerIdentity: 'agent:a', surfaceName: 'work', kind: 'status', content: 'first' };
    const second = { ...first, ownerIdentity: 'agent', surfaceName: 'a:work', content: 'second' };
    await repository.publishSurface(first);
    await repository.publishSurface(second);
    assert.deepEqual((await repository.getContext('agent:a', group))?.surfaces.map(item => item.content).sort(), ['first', 'second']);
    const other = new MongoCoordinationRepository(db, { ...scope, projectId: 'other-project' } as ProjectScope);
    assert.equal(await other.getContext('agent:a', group), null);
    await repository.registerDependency({ coordinationScope: group, dependencyId: 'owned-dependency',
      ownerIdentity: 'agent:a', dependsOn: 'peer', description: 'Original owner.' });
    await assert.rejects(repository.registerDependency({ coordinationScope: group, dependencyId: 'owned-dependency',
      ownerIdentity: 'agent', dependsOn: 'peer', description: 'Attempted takeover.' }), { code: 'CONFLICT' });
  });
}
