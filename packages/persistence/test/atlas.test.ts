import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import type { ProjectScope, RunId } from '@context-plane/contracts';
import { protectedReadReceipt } from '@context-plane/contracts/fixtures';
import { DurablePersistenceAdapter, connectStorage } from '../src/index.js';
import { sanitized, scopedKey } from '../src/validation.js';
import { conformance } from './conformance.js';

if (process.env.CONTEXT_PLANE_ATLAS_TESTS !== '1') {
  it('live Atlas tests require CONTEXT_PLANE_ATLAS_TESTS=1 and runtime MONGODB_URI', { skip: true }, () => {});
} else {
  // Never use MONGODB_DATABASE or a caller-supplied database for destructive cleanup.
  const database = 'cp_persistence_test_' + randomUUID().replaceAll('-', '');
  let connection: Awaited<ReturnType<typeof connectStorage>> | undefined;
  before(async () => {
    connection = await connectStorage(database);
    await connection.storage.initialize();
  });
  after(async () => {
    if (!connection) return;
    try {
      assert.match(database, /^cp_persistence_test_[a-f0-9]{32}$/);
      await sanitized(() => connection!.client.db(database).dropDatabase());
    } finally { await connection.close(); }
  });
  const expire = async (scope: ProjectScope, runId: RunId) => {
    // Test-only clock control. The product adapter never accepts a client clock.
    await sanitized(() => connection!.client.db(database).collection('cp_runs').updateOne(
      { _id: scopedKey(scope, runId) } as never, { $set: { 'value.expiresAt': new Date(0).toISOString() } }));
  };
  conformance('live Atlas (isolated temporary database)', async () => ({ storage: connection!.storage, expire }));

  it('verifies all required unique indexes on the real cluster', async () => {
    await sanitized(async () => {
      for (const collection of ['cp_projects', 'cp_runs', 'cp_receipts', 'cp_events']) {
        const indexes = await connection!.client.db(database).collection(collection).listIndexes().toArray();
        assert.ok(indexes.some(index => index.name === 'scope_key' && index.unique));
        if (collection === 'cp_events') assert.ok(indexes.some(index => index.name === 'scope_cursor' && index.unique));
      }
    });
  });
  it('reconnects through a new client and recovers checkpoint and receipt', async () => {
    const scope = { orgId: 'org-reconnect', projectId: randomUUID() } as ProjectScope;
    const runId = 'run-reconnect' as RunId;
    const first = await connectStorage(database);
    try {
      const adapter = new DurablePersistenceAdapter(first.storage);
      const lease = await adapter.acquireLease(scope, runId); assert.ok(lease);
      await adapter.saveReceipt({ ...protectedReadReceipt, scope, runId, leaseGeneration: lease.generation }, lease);
      await adapter.saveCheckpoint({ scope, runId, checkpointId: 'checkpoint-1', revision: 1,
        leaseGeneration: lease.generation, status: 'blocked', lastEventCursor: '000000', nextAction: 'await-human',
        completedOperationKeys: [], updatedAt: new Date().toISOString() }, lease);
    } finally { await first.close(); }
    await expire(scope, runId);
    const second = await connectStorage(database);
    try {
      const adapter = new DurablePersistenceAdapter(second.storage);
      const lease = await adapter.acquireLease(scope, runId); assert.equal(lease?.generation, 2);
      const cp = await adapter.readCheckpoint(scope, runId);
      assert.equal(cp?.nextAction, 'await-human'); assert.equal(cp?.revision, 1);
      const receipt = await adapter.readReceipt(scope, protectedReadReceipt.operationKey);
      assert.equal(receipt?.resultHash, protectedReadReceipt.resultHash);
      assert.deepEqual(receipt?.evidenceIds, protectedReadReceipt.evidenceIds);
    } finally { await second.close(); }
  });
}
