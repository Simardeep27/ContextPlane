import { randomUUID } from 'node:crypto';
import { immutableRecordKinds, recordKinds } from '@context-plane/contracts';
import type { CommitStep, ContextRecord, EventEnvelope, LeaseToken, OperationKey, OperationReceipt, PersistenceAdapter,
  ProjectProjection, ProjectScope, RecordKind, RecordOf, RecordWrite, RunCheckpoint, RunId } from '@context-plane/contracts';
import type { Storage, StorageTransaction } from './storage.js';
import { cursorNumber, hash, identifier, integer, requireThat, sameScope, scopedKey, timestamp } from './validation.js';

interface RunState { ownerId: string; generation: number; expiresAt: string; checkpoint: RunCheckpoint | null }
interface ProjectState { cursor: number; projection: ProjectProjection | null }
export interface AdapterOptions {
  /** A unique process incarnation, not a stable host name. Defaults to a UUID. */
  ownerId?: string;
  leaseDurationMs?: number;
}
/** @deprecated Scope is now part of the shared `LeaseToken`. */
export type ScopedLeaseToken = LeaseToken;
export type { CommitStep };

const recordKey = (kind: RecordKind, recordId: string) => kind + ':' + recordId;
const candidateOf = (record: ContextRecord): string | undefined =>
  record.kind === 'policy_candidate' ? record.sourceCandidateHash
    : record.kind === 'candidate' || record.kind === 'check_result' || record.kind === 'publication_authorization'
      ? record.candidateHash : undefined;

/** Implements the shared PersistenceAdapter. Authorization and workflow decisions stay in core/API. */
export class DurablePersistenceAdapter implements PersistenceAdapter {
  private readonly ownerId: string;
  private readonly leaseDurationMs: number;
  constructor(private readonly storage: Storage, options: AdapterOptions = {}) {
    this.ownerId = options.ownerId ?? randomUUID(); identifier(this.ownerId);
    // A 30-second demo lease needs renewal during long model/runner calls.
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    integer(this.leaseDurationMs, 100); requireThat(this.leaseDurationMs <= 300_000);
  }
  private project(tx: StorageTransaction): Promise<ProjectState> {
    return tx.get<ProjectState>('projects', 'state').then(state => state ?? { cursor: 0, projection: null });
  }
  private token(scope: ProjectScope, runId: RunId, run: RunState): LeaseToken {
    return { scope: { orgId: scope.orgId, projectId: scope.projectId }, runId, generation: run.generation, expiresAt: run.expiresAt };
  }
  private validateLease(lease: LeaseToken, scope?: ProjectScope) {
    identifier(lease?.runId); integer(lease?.generation, 1); timestamp(lease?.expiresAt);
    scopedKey(lease.scope, lease.runId);
    if (scope) sameScope(scope, lease.scope);
  }
  private async fenced(tx: StorageTransaction, runId: RunId, lease: LeaseToken): Promise<RunState> {
    this.validateLease(lease); requireThat(lease.runId === runId, 'LEASE_LOST');
    const run = await tx.get<RunState>('runs', runId);
    requireThat(run && run.ownerId === this.ownerId && run.generation === lease.generation &&
      Date.parse(run.expiresAt) > tx.now.getTime(), 'LEASE_LOST');
    return run;
  }
  async acquireLease(scope: ProjectScope, runId: RunId): Promise<LeaseToken | null> {
    scopedKey(scope, runId);
    return this.storage.transaction(scope, async tx => {
      const previous = await tx.get<RunState>('runs', runId);
      if (previous && Date.parse(previous.expiresAt) > tx.now.getTime()) return null;
      const run: RunState = { ownerId: this.ownerId, generation: (previous?.generation ?? 0) + 1,
        expiresAt: new Date(tx.now.getTime() + this.leaseDurationMs).toISOString(), checkpoint: previous?.checkpoint ?? null };
      await tx.put('runs', runId, run); return this.token(scope, runId, run);
    });
  }
  async renewLease(scope: ProjectScope, lease: LeaseToken): Promise<LeaseToken | null> {
    scopedKey(scope, lease?.runId); this.validateLease(lease, scope);
    return this.storage.transaction(scope, async tx => {
      const run = await tx.get<RunState>('runs', lease.runId);
      if (!run || run.ownerId !== this.ownerId || run.generation !== lease.generation || Date.parse(run.expiresAt) <= tx.now.getTime()) return null;
      run.expiresAt = new Date(tx.now.getTime() + this.leaseDurationMs).toISOString();
      await tx.put('runs', lease.runId, run); return this.token(scope, lease.runId, run);
    });
  }
  private validateEvent(event: EventEnvelope) {
    scopedKey(event.scope, event.eventId); identifier(event.runId); identifier(event.type);
    integer(event.revision, 1); integer(cursorNumber(event.cursor), 1); timestamp(event.occurredAt);
    requireThat(['human', 'agent', 'system'].includes(event.actor?.kind));
    identifier(event.actor.id);
    requireThat(['pm', 'orders', 'billing', 'notifications', 'system'].includes(event.actor.role));
    hash(event);
  }
  private async append(tx: StorageTransaction, event: EventEnvelope): Promise<void> {
    const previous = await tx.get<EventEnvelope>('events', event.eventId);
    if (previous) { requireThat(hash(previous) === hash(event), 'IDEMPOTENCY_CONFLICT'); return; }
    const project = await this.project(tx); const cursor = cursorNumber(event.cursor);
    requireThat(cursor === project.cursor + 1, 'CONFLICT');
    await tx.put('events', event.eventId, event, cursor);
    await tx.put('projects', 'state', { ...project, cursor });
  }
  /** Trusted API ingestion only; worker writes should use fenced commitStep. */
  async appendEvent(event: EventEnvelope): Promise<void> {
    this.validateEvent(event); const snapshot = structuredClone(event);
    await this.storage.transaction(event.scope, tx => this.append(tx, snapshot));
  }
  async readEvents(scope: ProjectScope, afterCursor = '000000'): Promise<readonly EventEnvelope[]> {
    scopedKey(scope, 'state');
    return this.storage.events<EventEnvelope>(scope, cursorNumber(afterCursor), 100);
  }
  private validateCheckpoint(checkpoint: RunCheckpoint, lease: LeaseToken) {
    scopedKey(checkpoint.scope, checkpoint.runId); identifier(checkpoint.checkpointId);
    this.validateLease(lease, checkpoint.scope); requireThat(checkpoint.runId === lease.runId, 'LEASE_LOST');
    integer(checkpoint.revision, 1); integer(checkpoint.leaseGeneration, 1);
    requireThat(checkpoint.leaseGeneration === lease.generation, 'LEASE_LOST');
    requireThat(['queued', 'running', 'blocked', 'completed', 'failed'].includes(checkpoint.status));
    timestamp(checkpoint.updatedAt); cursorNumber(checkpoint.lastEventCursor);
    requireThat(checkpoint.nextAction === null || typeof checkpoint.nextAction === 'string');
    requireThat(Array.isArray(checkpoint.completedOperationKeys) && checkpoint.completedOperationKeys.length <= 100);
    checkpoint.completedOperationKeys.forEach(identifier); hash(checkpoint);
  }
  private async checkpoint(tx: StorageTransaction, checkpoint: RunCheckpoint, lease: LeaseToken): Promise<void> {
    const previous = await tx.get<RunState>('runs', checkpoint.runId);
    if (previous?.checkpoint && hash(previous.checkpoint) === hash(checkpoint)) return;
    const run = await this.fenced(tx, checkpoint.runId, lease);
    requireThat(checkpoint.revision === (run.checkpoint?.revision ?? 0) + 1, 'CONFLICT');
    const project = await this.project(tx);
    requireThat(cursorNumber(checkpoint.lastEventCursor) <= project.cursor, 'CONFLICT');
    for (const operationKey of checkpoint.completedOperationKeys) {
      const receipt = await tx.get<OperationReceipt>('receipts', operationKey);
      requireThat(receipt?.runId === checkpoint.runId && receipt.status === 'succeeded', 'CONFLICT');
    }
    await tx.put('runs', checkpoint.runId, { ...run, checkpoint });
  }
  async saveCheckpoint(checkpoint: RunCheckpoint, lease: LeaseToken): Promise<void> {
    this.validateCheckpoint(checkpoint, lease); const snapshot = structuredClone(checkpoint);
    await this.storage.transaction(checkpoint.scope, tx => this.checkpoint(tx, snapshot, lease));
  }
  /** Additive read needed to resume a reclaimed run; missing in initial interface. */
  async readCheckpoint(scope: ProjectScope, runId: RunId): Promise<RunCheckpoint | null> {
    scopedKey(scope, runId); return (await this.storage.read<RunState>(scope, 'runs', runId))?.checkpoint ?? null;
  }
  private validateReceipt(receipt: OperationReceipt, lease: LeaseToken) {
    scopedKey(receipt.scope, receipt.operationKey); identifier(receipt.runId); identifier(receipt.kind);
    this.validateLease(lease, receipt.scope); requireThat(receipt.runId === lease.runId && receipt.leaseGeneration === lease.generation, 'LEASE_LOST');
    integer(receipt.attempt, 1); integer(receipt.leaseGeneration, 1);
    requireThat(['started', 'succeeded', 'failed'].includes(receipt.status)); timestamp(receipt.startedAt);
    if (receipt.status !== 'started') {
      timestamp(receipt.completedAt); requireThat(Date.parse(receipt.completedAt!) >= Date.parse(receipt.startedAt));
    }
    if (receipt.resultHash !== undefined) identifier(receipt.resultHash);
    requireThat(Array.isArray(receipt.evidenceIds) && receipt.evidenceIds.length <= 100);
    receipt.evidenceIds.forEach(identifier); hash(receipt);
  }
  private receiptHash(receipt: OperationReceipt): string {
    const { leaseGeneration, ...effect } = receipt; return hash(effect);
  }
  private async receipt(tx: StorageTransaction, receipt: OperationReceipt, lease: LeaseToken): Promise<void> {
    const previous = await tx.get<OperationReceipt>('receipts', receipt.operationKey);
    if (previous && this.receiptHash(previous) === this.receiptHash(receipt)) return;
    await this.fenced(tx, receipt.runId, lease);
    if (previous) {
      requireThat(previous.status === 'started' && receipt.status !== 'started' &&
        previous.runId === receipt.runId && previous.kind === receipt.kind && previous.attempt === receipt.attempt &&
        previous.startedAt === receipt.startedAt, 'IDEMPOTENCY_CONFLICT');
    }
    await tx.put('receipts', receipt.operationKey, receipt);
  }
  async saveReceipt(receipt: OperationReceipt, lease: LeaseToken): Promise<void> {
    this.validateReceipt(receipt, lease); const snapshot = structuredClone(receipt);
    await this.storage.transaction(receipt.scope, tx => this.receipt(tx, snapshot, lease));
  }
  async readReceipt(scope: ProjectScope, operationKey: OperationKey): Promise<OperationReceipt | null> {
    scopedKey(scope, operationKey); return this.storage.read(scope, 'receipts', operationKey);
  }
  private validateProjection(projection: ProjectProjection, expectedRevision: number) {
    scopedKey(projection.scope, 'state'); integer(expectedRevision); integer(projection.revision, 1);
    integer(projection.policyEpoch); cursorNumber(projection.eventCursor); hash(projection);
    requireThat(projection.revision > expectedRevision, 'CONFLICT');
  }
  private async projection(tx: StorageTransaction, projection: ProjectProjection, expectedRevision: number) {
    const project = await this.project(tx);
    if (project.projection && hash(project.projection) === hash(projection)) return;
    requireThat((project.projection?.revision ?? 0) === expectedRevision, 'CONFLICT');
    requireThat(cursorNumber(projection.eventCursor) <= project.cursor &&
      cursorNumber(projection.eventCursor) >= cursorNumber(project.projection?.eventCursor ?? '000000') &&
      projection.policyEpoch >= (project.projection?.policyEpoch ?? 0), 'CONFLICT');
    await tx.put('projects', 'state', { ...project, projection });
  }
  /** Store a projection computed/authorized by core. This adapter never derives it. */
  async saveProjection(projection: ProjectProjection, expectedRevision: number): Promise<void> {
    this.validateProjection(projection, expectedRevision); const snapshot = structuredClone(projection);
    await this.storage.transaction(projection.scope, tx => this.projection(tx, snapshot, expectedRevision));
  }
  async readProjection(scope: ProjectScope): Promise<ProjectProjection | null> {
    scopedKey(scope, 'state'); return (await this.storage.read<ProjectState>(scope, 'projects', 'state'))?.projection ?? null;
  }
  private validateRecord(write: RecordWrite) {
    const { record, expectedRevision } = write ?? {};
    requireThat(recordKinds.includes(record?.kind)); scopedKey(record.scope, record.recordId);
    integer(expectedRevision); integer(record.revision, 1);
    requireThat(record.revision === expectedRevision + 1, 'CONFLICT');
    timestamp(record.recordedAt);
    requireThat(Array.isArray(record.evidenceIds) && record.evidenceIds.length <= 100); record.evidenceIds.forEach(identifier);
    const version = (v: { candidateHash: string; dependencyRevision: number; policyEpoch: number }) => {
      identifier(v?.candidateHash); integer(v.dependencyRevision, 1); integer(v.policyEpoch);
    };
    switch (record.kind) {
      case 'dependency_revision':
        identifier(record.serviceId); requireThat(record.recordId === record.serviceId);
        integer(record.dependencyRevision, 1); identifier(record.artifactHash); identifier(record.publishedBy);
        requireThat(Array.isArray(record.consumers)); record.consumers.forEach(identifier);
        break;
      case 'candidate':
        requireThat(record.recordId === record.candidateHash); version(record.basedOn);
        // The candidate hash is fixed by its key; the version tuple must agree.
        requireThat(record.basedOn.candidateHash === record.candidateHash);
        identifier(record.serviceId); identifier(record.dependencyServiceId); identifier(record.authorAgentId);
        requireThat(['proposed', 'stale', 'staged', 'checked', 'authorized', 'published', 'rejected'].includes(record.status));
        requireThat(Array.isArray(record.artifactHashes) && record.artifactHashes.length > 0); record.artifactHashes.forEach(identifier);
        requireThat(Array.isArray(record.reasonCodes)); record.reasonCodes.forEach(identifier);
        break;
      case 'check_result':
        version(record.version); requireThat(record.version.candidateHash === record.candidateHash);
        identifier(record.registeredCommand); identifier(record.operationKey); requireThat(typeof record.passed === 'boolean');
        requireThat(Array.isArray(record.artifactHashes)); record.artifactHashes.forEach(identifier);
        break;
      case 'publication_authorization':
        requireThat(record.recordId === record.candidateHash); version(record.version);
        requireThat(record.version.candidateHash === record.candidateHash); identifier(record.dependencyServiceId);
        requireThat(record.decision === 'authorized' || record.decision === 'rejected');
        [record.checkResultIds, record.acknowledgedBy, record.reasonCodes].forEach(list => {
          requireThat(Array.isArray(list)); list.forEach(identifier);
        });
        requireThat(record.decision === 'rejected' || record.checkResultIds.length > 0);
        break;
      case 'policy_candidate':
        requireThat(record.recordId === record.policyCandidateHash); identifier(record.targetAgentId);
        identifier(record.sourceCandidateHash); requireThat(record.rule?.type === 'require_ack_before_stage');
        requireThat(['proposed', 'evaluated', 'rejected', 'promoted'].includes(record.status));
        break;
      case 'policy_version':
        integer(record.policyEpoch, 1); identifier(record.targetAgentId); identifier(record.policyCandidateHash);
        requireThat(record.recordId === record.targetAgentId + '@' + record.policyEpoch);
        requireThat(record.evaluation?.unsafeCasesCaught === record.evaluation?.unsafeCasesTotal &&
          record.evaluation.validCasesBlocked === 0);
        break;
    }
    hash(record);
  }
  private async record(tx: StorageTransaction, write: RecordWrite): Promise<void> {
    const { record } = write; const key = recordKey(record.kind, record.recordId);
    const previous = await tx.get<ContextRecord>('records', key);
    if (previous && hash(previous) === hash(record)) return;
    requireThat(!previous || !immutableRecordKinds.includes(record.kind), 'IDEMPOTENCY_CONFLICT');
    requireThat((previous?.revision ?? 0) === write.expectedRevision, 'CONFLICT');
    const head = (serviceId: string) => tx.get<RecordOf<'dependency_revision'>>('records', recordKey('dependency_revision', serviceId));
    switch (record.kind) {
      case 'dependency_revision': {
        // The published head only moves forward, one revision at a time.
        const prior = previous as RecordOf<'dependency_revision'> | null;
        requireThat(!prior || record.dependencyRevision === prior.dependencyRevision + 1, 'CONFLICT');
        break;
      }
      case 'candidate': {
        const prior = previous as RecordOf<'candidate'> | null;
        requireThat(!prior || (prior.serviceId === record.serviceId && prior.authorAgentId === record.authorAgentId &&
          prior.dependencyServiceId === record.dependencyServiceId), 'CONFLICT');
        const current = await head(record.dependencyServiceId);
        requireThat(!current || record.basedOn.dependencyRevision <= current.dependencyRevision, 'CONFLICT');
        break;
      }
      case 'publication_authorization': {
        if (record.decision !== 'authorized') break;
        // Only the exact candidate whose checks passed under the current
        // dependency head and policy epoch can be authorized.
        const current = await head(record.dependencyServiceId);
        const project = await this.project(tx);
        requireThat(current?.dependencyRevision === record.version.dependencyRevision &&
          (project.projection?.policyEpoch ?? record.version.policyEpoch) === record.version.policyEpoch, 'CONFLICT');
        for (const id of record.checkResultIds) {
          const check = await tx.get<RecordOf<'check_result'>>('records', recordKey('check_result', id));
          requireThat(check?.passed === true && hash(check.version) === hash(record.version), 'CONFLICT');
        }
        break;
      }
      case 'policy_version':
        requireThat(record.policyEpoch === 1 ||
          await tx.get('records', recordKey('policy_version', record.targetAgentId + '@' + (record.policyEpoch - 1))) !== null, 'CONFLICT');
        break;
    }
    await tx.put('records', key, record);
  }
  /** Trusted API/seed write; worker writes use fenced commitStep. */
  async saveRecord(write: RecordWrite): Promise<void> {
    this.validateRecord(write); const snapshot = structuredClone(write);
    await this.storage.transaction(write.record.scope, tx => this.record(tx, snapshot));
  }
  async readRecord<Kind extends RecordKind>(scope: ProjectScope, kind: Kind, recordId: string): Promise<RecordOf<Kind> | null> {
    requireThat(recordKinds.includes(kind)); scopedKey(scope, recordId);
    return this.storage.read<RecordOf<Kind>>(scope, 'records', recordKey(kind, recordId));
  }
  async listRecords<Kind extends RecordKind>(scope: ProjectScope, kind: Kind): Promise<readonly RecordOf<Kind>[]> {
    requireThat(recordKinds.includes(kind)); scopedKey(scope, 'state');
    return this.storage.list<RecordOf<Kind>>(scope, 'records', kind + ':', 100);
  }
  /** Atomically save one worker step. No runner/model calls inside this method. */
  async commitStep(input: CommitStep): Promise<void> {
    const step = structuredClone(input); const scope = step.checkpoint.scope;
    this.validateCheckpoint(step.checkpoint, step.lease);
    if (step.event) {
      this.validateEvent(step.event); sameScope(scope, step.event.scope);
      requireThat(step.event.runId === step.checkpoint.runId && step.event.cursor === step.checkpoint.lastEventCursor);
    }
    if (step.receipt) {
      this.validateReceipt(step.receipt, step.lease); sameScope(scope, step.receipt.scope);
      requireThat(step.receipt.runId === step.checkpoint.runId);
    }
    if (step.projection) {
      this.validateProjection(step.projection.value, step.projection.expectedRevision); sameScope(scope, step.projection.value.scope);
    }
    const records = step.records ?? [];
    requireThat(Array.isArray(records) && records.length <= 20);
    for (const write of records) {
      this.validateRecord(write); sameScope(scope, write.record.scope);
      const named = candidateOf(write.record);
      if (step.candidateHash !== undefined && named !== undefined) requireThat(named === step.candidateHash, 'CONFLICT');
    }
    await this.storage.transaction(scope, async tx => {
      // An exact retry is read-only at the domain level and may be reconciled
      // after expiry. Any new write must pass the current lease fence.
      const run = await tx.get<RunState>('runs', step.checkpoint.runId);
      const existingEvent = step.event ? await tx.get<EventEnvelope>('events', step.event.eventId) : null;
      const existingReceipt = step.receipt ? await tx.get<OperationReceipt>('receipts', step.receipt.operationKey) : null;
      const project = await this.project(tx);
      let recordsReplayed = true;
      for (const { record } of records) {
        const existing = await tx.get<ContextRecord>('records', recordKey(record.kind, record.recordId));
        if (!existing || hash(existing) !== hash(record)) { recordsReplayed = false; break; }
      }
      const replay = recordsReplayed && run?.checkpoint && hash(run.checkpoint) === hash(step.checkpoint) &&
        (!step.event || (existingEvent && hash(existingEvent) === hash(step.event))) &&
        (!step.receipt || (existingReceipt && this.receiptHash(existingReceipt) === this.receiptHash(step.receipt))) &&
        (!step.projection || (project.projection && hash(project.projection) === hash(step.projection.value)));
      if (replay) return;
      // A saved checkpoint cannot be reused to attach new effects. Advancing
      // the operation set requires a new revision, even under the same lease.
      requireThat(!run?.checkpoint || hash(run.checkpoint) !== hash(step.checkpoint), 'IDEMPOTENCY_CONFLICT');
      await this.fenced(tx, step.checkpoint.runId, step.lease);
      if (step.event) await this.append(tx, step.event);
      if (step.receipt) await this.receipt(tx, step.receipt, step.lease);
      for (const write of records) await this.record(tx, write);
      await this.checkpoint(tx, step.checkpoint, step.lease);
      if (step.projection) await this.projection(tx, step.projection.value, step.projection.expectedRevision);
    });
  }
}
