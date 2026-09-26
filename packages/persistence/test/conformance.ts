import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { EventEnvelope, LeaseToken, OperationKey, OperationReceipt, PersistenceAdapter,
  ProjectScope, RunCheckpoint, RunId } from '@context-plane/contracts';
import { blockedResumedCompletedEvents, blockedResumedCompletedProjections, protectedReadReceipt } from '@context-plane/contracts/fixtures';
import { DurablePersistenceAdapter, formatCursor } from '../src/index.js';
import type { Storage } from '../src/storage.js';

export interface Harness { storage: Storage; expire: (scope: ProjectScope, runId: RunId) => Promise<void> }
const runId = 'run-1' as RunId;
const scope = (): ProjectScope => ({ orgId: 'org-test', projectId: randomUUID() } as ProjectScope);
function checkpoint(s: ProjectScope, lease: LeaseToken, revision = 1): RunCheckpoint {
  return { scope: s, runId, checkpointId: 'checkpoint-' + revision, revision, leaseGeneration: lease.generation,
    status: 'running', lastEventCursor: '000000', nextAction: 'registered-check', completedOperationKeys: [],
    updatedAt: new Date().toISOString() };
}
function receipt(s: ProjectScope, lease: LeaseToken): OperationReceipt {
  return { ...protectedReadReceipt, scope: s, runId, leaseGeneration: lease.generation };
}
function event(s: ProjectScope, cursor = 1): EventEnvelope {
  return { ...structuredClone(blockedResumedCompletedEvents[0]), scope: s, runId, eventId: ('event-' + cursor) as EventEnvelope['eventId'],
    cursor: formatCursor(cursor), revision: cursor };
}
async function claim(adapter: DurablePersistenceAdapter, s: ProjectScope) {
  const lease = await adapter.acquireLease(s, runId); assert.ok(lease); return lease;
}
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, { code });

export function conformance(name: string, setup: () => Promise<Harness>) {
  describe(name, () => {
    async function fixture() {
      const harness = await setup(); const s = scope();
      const adapter = new DurablePersistenceAdapter(harness.storage);
      const contract: PersistenceAdapter = adapter; assert.ok(contract);
      return { ...harness, s, adapter };
    }
    it('round-trips shared blocked/resumed/completed events and projections', async () => {
      const { adapter, s } = await fixture();
      for (const original of blockedResumedCompletedEvents) await adapter.appendEvent({ ...original, scope: s });
      let expected = 0;
      for (const original of blockedResumedCompletedProjections) {
        const projection = { ...original, scope: s };
        await adapter.saveProjection(projection, expected); expected = projection.revision;
        assert.deepEqual(await adapter.readProjection(s), projection);
      }
      assert.equal((await adapter.readEvents(s)).length, 4);
      assert.deepEqual((await adapter.readEvents(s, '000002')).map(e => e.cursor), ['000003', '000004']);
    });
    it('deduplicates simultaneous event retries and rejects changed content', async () => {
      const { adapter, s } = await fixture(); const e = event(s);
      await Promise.all(Array.from({ length: 6 }, () => adapter.appendEvent(e)));
      assert.equal((await adapter.readEvents(s)).length, 1);
      await rejects(adapter.appendEvent({ ...e, payload: { tampered: true } }), 'IDEMPOTENCY_CONFLICT');
      assert.deepEqual((await adapter.readEvents(s))[0], e);
    });
    it('rejects gaps and competing cursors; resumes only committed ordered events', async () => {
      const { adapter, s } = await fixture();
      await rejects(adapter.appendEvent(event(s, 2)), 'CONFLICT');
      await adapter.appendEvent(event(s));
      await rejects(adapter.appendEvent({ ...event(s), eventId: 'other' as EventEnvelope['eventId'] }), 'CONFLICT');
      await adapter.appendEvent(event(s, 2));
      assert.deepEqual((await adapter.readEvents(s, '000001')).map(e => e.cursor), ['000002']);
      await rejects(adapter.readEvents(s, '1'), 'INVALID_INPUT');
    });
    it('isolates org/project reads and tokens even when run IDs/generations coincide', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      await adapter.appendEvent(event(s)); await adapter.saveReceipt(receipt(s, lease), lease);
      for (const other of [{ ...s, projectId: 'elsewhere' }, { ...s, orgId: 'elsewhere' }] as ProjectScope[]) {
        assert.deepEqual(await adapter.readEvents(other), []);
        assert.equal(await adapter.readReceipt(other, protectedReadReceipt.operationKey), null);
        assert.equal(await adapter.readCheckpoint(other, runId), null);
        assert.equal(await adapter.readProjection(other), null);
        const otherLease = await claim(adapter, other); assert.equal(otherLease.generation, lease.generation);
        await rejects(adapter.saveCheckpoint(checkpoint(other, lease), lease), 'INVALID_INPUT');
        await rejects(adapter.saveReceipt(receipt(other, lease), lease), 'INVALID_INPUT');
        await rejects(adapter.renewLease(other, lease), 'INVALID_INPUT');
      }
    });
    it('allows exactly one simultaneous claimant and preserves monotonic generations', async () => {
      const { storage, s, expire } = await fixture();
      const workers = Array.from({ length: 6 }, () => new DurablePersistenceAdapter(storage));
      const leases = await Promise.all(workers.map(worker => worker.acquireLease(s, runId)));
      assert.equal(leases.filter(Boolean).length, 1);
      await expire(s, runId);
      const next = await claim(workers[0]!, s); assert.equal(next.generation, 2);
    });
    it('rejects a stolen token on a different worker and renews without losing progress', async () => {
      const { adapter, storage, s } = await fixture(); const lease = await claim(adapter, s);
      const other = new DurablePersistenceAdapter(storage);
      assert.equal(await other.renewLease(s, lease), null);
      await rejects(other.saveCheckpoint(checkpoint(s, lease), lease), 'LEASE_LOST');
      await adapter.saveCheckpoint(checkpoint(s, lease), lease);
      const renewed = await adapter.renewLease(s, lease); assert.ok(renewed);
      assert.equal(renewed.generation, lease.generation);
      assert.ok(Date.parse(renewed.expiresAt) >= Date.parse(lease.expiresAt));
      assert.equal((await adapter.readCheckpoint(s, runId))?.revision, 1);
    });
    it('rejects expired leases even before reclaim', async () => {
      const { adapter, s, expire } = await fixture(); const lease = await claim(adapter, s);
      await expire(s, runId);
      assert.equal(await adapter.renewLease(s, lease), null);
      await rejects(adapter.saveCheckpoint(checkpoint(s, lease), lease), 'LEASE_LOST');
      await rejects(adapter.saveReceipt(receipt(s, lease), lease), 'LEASE_LOST');
    });
    it('rejects stale checkpoint revisions including concurrent competing writers', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      const first = checkpoint(s, lease);
      const results = await Promise.allSettled([adapter.saveCheckpoint(first, lease),
        adapter.saveCheckpoint({ ...first, nextAction: 'different' }, lease)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await adapter.readCheckpoint(s, runId))?.revision, 1);
      await rejects(adapter.saveCheckpoint(checkpoint(s, lease, 3), lease), 'CONFLICT');
    });
    it('deduplicates operation retries and keeps terminal evidence immutable', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s); const r = receipt(s, lease);
      await Promise.all(Array.from({ length: 6 }, () => adapter.saveReceipt(r, lease)));
      assert.deepEqual(await adapter.readReceipt(s, r.operationKey), r);
      await rejects(adapter.saveReceipt({ ...r, resultHash: 'changed' }, lease), 'IDEMPOTENCY_CONFLICT');
      await rejects(adapter.saveReceipt({ ...r, runId: 'different-run' as RunId }, lease), 'LEASE_LOST');
    });
    it('reconciles started operations after reclaim and forbids rewriting terminal results', async () => {
      const { adapter, storage, s, expire } = await fixture(); const lease = await claim(adapter, s);
      const final = receipt(s, lease); const { completedAt, resultHash, ...base } = final;
      await adapter.saveReceipt({ ...base, status: 'started', evidenceIds: [] }, lease);
      await expire(s, runId);
      const restarted = new DurablePersistenceAdapter(storage); const next = await claim(restarted, s);
      assert.equal((await restarted.readReceipt(s, final.operationKey))?.status, 'started');
      await restarted.saveReceipt({ ...final, leaseGeneration: next.generation }, next);
      await rejects(adapter.saveReceipt({ ...final, resultHash: 'stale-effect' }, lease), 'LEASE_LOST');
      assert.equal((await restarted.readReceipt(s, final.operationKey))?.status, 'succeeded');
    });
    it('crash/reclaim resumes saved progress and fences the old worker', async () => {
      const { adapter, storage, s, expire } = await fixture(); const lease = await claim(adapter, s);
      const r = receipt(s, lease); const cp = { ...checkpoint(s, lease), completedOperationKeys: [r.operationKey], lastEventCursor: '000001' };
      await adapter.commitStep({ checkpoint: cp, lease, receipt: r, event: event(s) });
      await expire(s, runId);
      const restarted = new DurablePersistenceAdapter(storage); const next = await claim(restarted, s);
      assert.deepEqual(await restarted.readCheckpoint(s, runId), cp);
      assert.deepEqual(await restarted.readReceipt(s, r.operationKey), r);
      await rejects(adapter.commitStep({ checkpoint: { ...cp, revision: 2, lastEventCursor: '000002' }, lease, event: event(s, 2) }), 'LEASE_LOST');
      await restarted.commitStep({ checkpoint: { ...cp, checkpointId: 'checkpoint-2', revision: 2,
        leaseGeneration: next.generation, lastEventCursor: '000002' }, lease: next, event: event(s, 2),
        receipt: { ...r, leaseGeneration: next.generation } });
      assert.equal((await restarted.readEvents(s)).length, 2);
      assert.deepEqual(await restarted.readReceipt(s, r.operationKey), r);
    });
    it('rolls back event and receipt when checkpoint CAS fails', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      await rejects(adapter.commitStep({ lease, event: event(s), receipt: receipt(s, lease),
        checkpoint: { ...checkpoint(s, lease, 2), lastEventCursor: '000001' } }), 'CONFLICT');
      assert.deepEqual(await adapter.readEvents(s), []);
      assert.equal(await adapter.readReceipt(s, protectedReadReceipt.operationKey), null);
      assert.equal(await adapter.readCheckpoint(s, runId), null);
      await adapter.commitStep({ lease, event: event(s), receipt: receipt(s, lease),
        checkpoint: { ...checkpoint(s, lease), lastEventCursor: '000001' } });
      assert.equal((await adapter.readEvents(s))[0]?.cursor, '000001');
    });
    it('replays an entire committed step without creating duplicate evidence', async () => {
      const { adapter, s, expire } = await fixture(); const lease = await claim(adapter, s);
      const step = { lease, event: event(s), receipt: receipt(s, lease), checkpoint: { ...checkpoint(s, lease), lastEventCursor: '000001' } };
      await adapter.commitStep(step); await expire(s, runId); await adapter.commitStep(step);
      assert.equal((await adapter.readEvents(s)).length, 1);
      assert.equal((await adapter.readCheckpoint(s, runId))?.revision, 1);
    });
    it('cannot attach a new effect to an already committed checkpoint revision', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      const cp = checkpoint(s, lease);
      await adapter.commitStep({ checkpoint: cp, lease });
      await rejects(adapter.commitStep({ checkpoint: cp, lease, receipt: receipt(s, lease) }), 'IDEMPOTENCY_CONFLICT');
      assert.equal(await adapter.readReceipt(s, protectedReadReceipt.operationKey), null);
    });
    it('rejects projection CAS conflicts and rolls back a whole worker step', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      await adapter.appendEvent(event(s));
      const p = { ...blockedResumedCompletedProjections[0], scope: s };
      await adapter.saveProjection(p, 0);
      await rejects(adapter.commitStep({ lease, event: event(s, 2), receipt: receipt(s, lease),
        checkpoint: { ...checkpoint(s, lease), lastEventCursor: '000002' },
        projection: { value: { ...p, revision: 2, eventCursor: '000002' }, expectedRevision: 0 } }), 'CONFLICT');
      assert.equal((await adapter.readEvents(s)).length, 1);
      assert.equal(await adapter.readReceipt(s, protectedReadReceipt.operationKey), null);
      assert.deepEqual(await adapter.readProjection(s), p);
    });
    it('rejects unreceipted completion and future event references', async () => {
      const { adapter, s } = await fixture(); const lease = await claim(adapter, s);
      await rejects(adapter.saveCheckpoint({ ...checkpoint(s, lease), completedOperationKeys: ['missing' as OperationKey] }, lease), 'CONFLICT');
      await rejects(adapter.saveCheckpoint({ ...checkpoint(s, lease), lastEventCursor: '000001' }, lease), 'CONFLICT');
    });
    it('validates runtime inputs and does not expose mutable references', async () => {
      const { adapter, s } = await fixture();
      await rejects(adapter.acquireLease({ ...s, orgId: { $ne: null } } as unknown as ProjectScope, runId), 'INVALID_INPUT');
      await rejects(adapter.appendEvent({ ...event(s), payload: { invalid: Number.NaN } }), 'INVALID_INPUT');
      await rejects(adapter.appendEvent({ ...event(s), payload: { large: 'x'.repeat(140_000) } }), 'INVALID_INPUT');
      const e = event(s); await adapter.appendEvent(e);
      (e.payload as { reason: string }).reason = 'caller mutation';
      const read = await adapter.readEvents(s); (read[0]!.payload as { reason: string }).reason = 'read mutation';
      assert.notEqual((await adapter.readEvents(s))[0]?.payload, read[0]?.payload);
      assert.equal(((await adapter.readEvents(s))[0]?.payload as { reason: string }).reason, blockedResumedCompletedEvents[0].payload.reason);
    });
  });
}
