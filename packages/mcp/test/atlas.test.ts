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
}
