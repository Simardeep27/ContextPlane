import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { AgentId, CandidateHash, CandidateRecord, CheckResultRecord, DependencyRevisionRecord, EvidenceId,
  LeaseToken, OperationKey, ProjectScope, PublicationAuthorizationRecord, RecordWrite, RunId, ServiceId,
  ArtifactHash, UserId, PolicyVersionRecord, PolicyCandidateHash, DatasetHash } from '@context-plane/contracts';
import { blockedResumedCompletedEvents, blockedResumedCompletedProjections, protectedReadReceipt } from '@context-plane/contracts/fixtures';
import { DurablePersistenceAdapter, formatCursor } from '../src/index.js';
import type { Harness } from './conformance.js';

const at = '2026-09-26T14:00:00.000Z';
const producer = 'svc-orders-api' as ServiceId;
const consumer = 'svc-billing' as ServiceId;
const devA = 'agent_billing' as AgentId;
const devB = 'agent_orders' as AgentId;
const candidateHash = 'sha256:candidate-a' as CandidateHash;
const runId = 'run-records' as RunId;
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, { code });

function dependency(s: ProjectScope, dependencyRevision: number, revision = dependencyRevision): DependencyRevisionRecord {
  return { kind: 'dependency_revision', scope: s, recordId: producer, revision, recordedAt: at, evidenceIds: [],
    serviceId: producer, dependencyRevision, artifactHash: ('sha256:orders-' + dependencyRevision) as ArtifactHash,
    publishedBy: devB, consumers: [consumer] };
}
function candidate(s: ProjectScope, dependencyRevision: number, revision = 1, status: CandidateRecord['status'] = 'proposed'): CandidateRecord {
  return { kind: 'candidate', scope: s, recordId: candidateHash, revision, recordedAt: at, evidenceIds: [],
    candidateHash, serviceId: consumer, authorAgentId: devA, dependencyServiceId: producer,
    basedOn: { candidateHash, dependencyRevision, policyEpoch: 1 }, artifactHashes: ['sha256:billing-a' as ArtifactHash],
    status, reasonCodes: [] };
}
function check(s: ProjectScope, dependencyRevision: number, passed = true, id = 'check-' + dependencyRevision): CheckResultRecord {
  return { kind: 'check_result', scope: s, recordId: id, revision: 1, recordedAt: at, evidenceIds: ['evidence-ci' as EvidenceId],
    candidateHash, registeredCommand: 'cross-service', operationKey: ('op-' + id) as OperationKey,
    version: { candidateHash, dependencyRevision, policyEpoch: 1 }, passed, artifactHashes: ['sha256:billing-a' as ArtifactHash] };
}
function authorization(s: ProjectScope, dependencyRevision: number, checkResultIds: string[]): PublicationAuthorizationRecord {
  return { kind: 'publication_authorization', scope: s, recordId: candidateHash, revision: 1, recordedAt: at, evidenceIds: [],
    candidateHash, dependencyServiceId: producer, version: { candidateHash, dependencyRevision, policyEpoch: 1 },
    decision: 'authorized', checkResultIds, acknowledgedBy: [devB], reasonCodes: [] };
}
function policyVersion(s: ProjectScope, policyEpoch: number, blocked = 0): PolicyVersionRecord {
  return { kind: 'policy_version', scope: s, recordId: devA + '@' + policyEpoch, revision: 1, recordedAt: at, evidenceIds: [],
    targetAgentId: devA, policyEpoch, policyCandidateHash: 'sha256:policy' as PolicyCandidateHash,
    rules: [{ type: 'require_ack_before_stage', whenDependencyServiceId: producer, whenDependencyAdvancedPastBase: true, requireAckFrom: devB }],
    evaluation: { datasetHash: 'sha256:dataset' as DatasetHash, unsafeCasesTotal: 2, unsafeCasesCaught: 2, validCasesTotal: 3, validCasesBlocked: blocked },
    promotedBy: 'user_pm' as UserId };
}
const write = <R extends RecordWrite['record']>(record: R, expectedRevision = record.revision - 1): RecordWrite => ({ record, expectedRevision });

export function recordConformance(name: string, setup: () => Promise<Harness>) {
  describe(name, () => {
    async function fixture() {
      const harness = await setup();
      const s = { orgId: 'org-records', projectId: randomUUID() } as ProjectScope;
      return { ...harness, s, adapter: new DurablePersistenceAdapter(harness.storage) };
    }

    it('round-trips records with compare-and-set and isolates projects', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      await adapter.saveRecord(write(candidate(s, 7)));
      assert.deepEqual(await adapter.readRecord(s, 'candidate', candidateHash), candidate(s, 7));
      await rejects(adapter.saveRecord(write(candidate(s, 7, 1, 'staged'))), 'CONFLICT');
      await adapter.saveRecord(write(candidate(s, 7, 2, 'stale')));
      assert.equal((await adapter.readRecord(s, 'candidate', candidateHash))?.status, 'stale');
      await adapter.saveRecord(write(candidate(s, 7, 2, 'stale'))); // exact retry is a no-op
      assert.deepEqual((await adapter.listRecords(s, 'dependency_revision')).map(r => r.dependencyRevision), [7]);
      const other = { ...s, projectId: 'elsewhere' } as ProjectScope;
      assert.equal(await adapter.readRecord(other, 'candidate', candidateHash), null);
      assert.deepEqual(await adapter.listRecords(other, 'candidate'), []);
    });

    it('advances a dependency head exactly one revision at a time', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      await rejects(adapter.saveRecord(write(dependency(s, 9, 2))), 'CONFLICT');
      await rejects(adapter.saveRecord(write(dependency(s, 6, 2))), 'CONFLICT');
      await adapter.saveRecord(write(dependency(s, 8, 2)));
      assert.equal((await adapter.readRecord(s, 'dependency_revision', producer))?.dependencyRevision, 8);
    });

    it('rejects candidates based on a future revision but keeps stale ones', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      await rejects(adapter.saveRecord(write(candidate(s, 8))), 'CONFLICT');
      await adapter.saveRecord(write(candidate(s, 7)));
      await adapter.saveRecord(write(dependency(s, 8, 2)));
      await adapter.saveRecord(write(candidate(s, 7, 2, 'stale')));
    });

    it('authorizes only the exact candidate that passed under the current head', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      await adapter.saveRecord(write(check(s, 7)));
      await adapter.saveRecord(write(dependency(s, 8, 2)));
      // Stale: the passing check and the authorization are both pinned to N.
      await rejects(adapter.saveRecord(write(authorization(s, 7, ['check-7']))), 'CONFLICT');
      // Current version but the referenced check failed / does not exist.
      await adapter.saveRecord(write(check(s, 8, false, 'check-8-failed')));
      await rejects(adapter.saveRecord(write(authorization(s, 8, ['check-8-failed']))), 'CONFLICT');
      await rejects(adapter.saveRecord(write(authorization(s, 8, ['missing']))), 'CONFLICT');
      // Check pinned to N cannot authorize N+1.
      await rejects(adapter.saveRecord(write(authorization(s, 8, ['check-7']))), 'CONFLICT');
      await adapter.saveRecord(write(check(s, 8)));
      await adapter.saveRecord(write(authorization(s, 8, ['check-8'])));
      assert.equal((await adapter.readRecord(s, 'publication_authorization', candidateHash))?.decision, 'authorized');
    });

    it('rejects an authorization pinned to a stale policy epoch', async () => {
      const { adapter, s } = await fixture();
      await adapter.appendEvent({ ...blockedResumedCompletedEvents[0], scope: s });
      await adapter.saveProjection({ ...blockedResumedCompletedProjections[0], scope: s, policyEpoch: 2 }, 0);
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      await adapter.saveRecord(write(check(s, 7)));
      await rejects(adapter.saveRecord(write(authorization(s, 7, ['check-7']))), 'CONFLICT');
    });

    it('keeps evidence records immutable and policy versions sequential and passing', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(check(s, 7)));
      await adapter.saveRecord(write(check(s, 7)));
      await rejects(adapter.saveRecord(write({ ...check(s, 7), passed: false })), 'IDEMPOTENCY_CONFLICT');
      await rejects(adapter.saveRecord(write(policyVersion(s, 2))), 'CONFLICT');
      await rejects(adapter.saveRecord(write(policyVersion(s, 1, 1))), 'INVALID_INPUT');
      await adapter.saveRecord(write(policyVersion(s, 1)));
      await adapter.saveRecord(write(policyVersion(s, 2)));
      assert.deepEqual((await adapter.listRecords(s, 'policy_version')).map(r => r.policyEpoch), [1, 2]);
    });

    it('commits event, receipt, checkpoint, projection, and records under one candidate hash', async () => {
      const { adapter, s } = await fixture();
      await adapter.saveRecord(write(dependency(s, 7, 1)));
      const lease = await adapter.acquireLease(s, runId); assert.ok(lease);
      const receipt = { ...protectedReadReceipt, scope: s, runId, leaseGeneration: lease.generation };
      const event = { ...structuredClone(blockedResumedCompletedEvents[0]), scope: s, runId, cursor: formatCursor(1), revision: 1 };
      const step = {
        lease, candidateHash, event, receipt,
        checkpoint: { scope: s, runId, checkpointId: 'cp-1', revision: 1, leaseGeneration: lease.generation, status: 'running' as const,
          lastEventCursor: '000001', nextAction: 'authorize', completedOperationKeys: [receipt.operationKey], updatedAt: at },
        projection: { value: { ...blockedResumedCompletedProjections[0], scope: s }, expectedRevision: 0 },
        records: [write(candidate(s, 7)), write(check(s, 7))],
      };
      // A record naming another candidate aborts the whole step.
      const foreign = { ...candidate(s, 7), recordId: 'sha256:other', candidateHash: 'sha256:other' as CandidateHash,
        basedOn: { candidateHash: 'sha256:other' as CandidateHash, dependencyRevision: 7, policyEpoch: 1 } };
      await rejects(adapter.commitStep({ ...step, records: [...step.records, write(foreign)] }), 'CONFLICT');
      assert.deepEqual(await adapter.readEvents(s), []);
      assert.equal(await adapter.readRecord(s, 'check_result', 'check-7'), null);

      await adapter.commitStep(step);
      await adapter.commitStep(step); // replay is a no-op
      assert.equal((await adapter.readEvents(s)).length, 1);
      assert.equal((await adapter.readRecord(s, 'candidate', candidateHash))?.candidateHash, candidateHash);
      assert.equal((await adapter.readRecord(s, 'check_result', 'check-7'))?.candidateHash, candidateHash);
      assert.equal((await adapter.readReceipt(s, receipt.operationKey))?.status, 'succeeded');
      assert.equal((await adapter.readCheckpoint(s, runId))?.revision, 1);
      assert.equal((await adapter.readProjection(s))?.revision, 1);
    });

    it('rejects a lease token without its project scope', async () => {
      const { adapter, s } = await fixture();
      const lease = await adapter.acquireLease(s, runId); assert.ok(lease);
      const { scope: _dropped, ...unscoped } = lease;
      await rejects(adapter.renewLease(s, unscoped as unknown as LeaseToken), 'INVALID_INPUT');
    });
  });
}
