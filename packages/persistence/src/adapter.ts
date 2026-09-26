import { randomUUID } from 'node:crypto';
import type { ChangeCheckVersion, CommitStep, EventEnvelope, LeaseToken, OperationKey, OperationReceipt, PersistenceAdapter,
  ProjectProjection, ProjectScope, RunCheckpoint, RunId } from '@context-plane/contracts';
import type { Storage, StorageTransaction } from './storage.js';
import { cursorNumber, hash, identifier, integer, requireThat, sameScope, scopedKey, timestamp } from './validation.js';

interface RunState { ownerId: string; generation: number; expiresAt: string; checkpoint: RunCheckpoint | null }
interface ProjectState { cursor: number; projection: ProjectProjection | null }
export interface AdapterOptions {
  /** A unique process incarnation, not a stable host name. Defaults to a UUID. */
  ownerId?: string;
  leaseDurationMs?: number;
}

/** Implements wireframe e6012cd. Authorization and workflow decisions stay in core/API. */
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
  private token<Scope extends ProjectScope>(scope: Scope, runId: RunId, run: RunState): LeaseToken<Scope> {
    return { scope: structuredClone(scope), runId, generation: run.generation, expiresAt: run.expiresAt };
  }
  private validateLease(lease: LeaseToken, scope?: ProjectScope) {
    identifier(lease?.runId); integer(lease?.generation, 1); timestamp(lease?.expiresAt);
    if (scope) sameScope(scope, lease.scope);
  }
  private async fenced(tx: StorageTransaction, runId: RunId, lease: LeaseToken): Promise<RunState> {
    this.validateLease(lease); requireThat(lease.runId === runId, 'LEASE_LOST');
    const run = await tx.get<RunState>('runs', runId);
    requireThat(run && run.ownerId === this.ownerId && run.generation === lease.generation &&
      Date.parse(run.expiresAt) > tx.now.getTime(), 'LEASE_LOST');
    return run;
  }
  async acquireLease<Scope extends ProjectScope>(scope: Scope, runId: RunId): Promise<LeaseToken<Scope> | null> {
    scopedKey(scope, runId);
    return this.storage.transaction(scope, async tx => {
      const previous = await tx.get<RunState>('runs', runId);
      if (previous && Date.parse(previous.expiresAt) > tx.now.getTime()) return null;
      const run: RunState = { ownerId: this.ownerId, generation: (previous?.generation ?? 0) + 1,
        expiresAt: new Date(tx.now.getTime() + this.leaseDurationMs).toISOString(), checkpoint: previous?.checkpoint ?? null };
      await tx.put('runs', runId, run); return this.token(scope, runId, run);
    });
  }
  async renewLease<Scope extends ProjectScope>(scope: Scope, lease: LeaseToken<Scope>): Promise<LeaseToken<Scope> | null> {
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
    if (event.candidateVersion) this.validateCandidateVersion(event.candidateVersion);
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
    if (checkpoint.candidateVersion) this.validateCandidateVersion(checkpoint.candidateVersion);
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
    receipt.evidenceIds.forEach(identifier);
    if (receipt.candidateVersion) this.validateCandidateVersion(receipt.candidateVersion);
    hash(receipt);
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
    if (projection.candidateVersion) this.validateCandidateVersion(projection.candidateVersion);
  }
  private validateCandidateVersion(version: ChangeCheckVersion) {
    identifier(version?.candidateHash); integer(version?.dependencyRevision); integer(version?.policyEpoch);
  }
  private sameCandidateVersion(expected: ChangeCheckVersion, actual?: ChangeCheckVersion) {
    requireThat(actual, 'CONFLICT');
    requireThat(actual.candidateHash === expected.candidateHash &&
      actual.dependencyRevision === expected.dependencyRevision &&
      actual.policyEpoch === expected.policyEpoch, 'CONFLICT');
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
  /** Atomically save one worker step. No runner/model calls inside this method. */
  async commitStep<Version extends ChangeCheckVersion, Scope extends ProjectScope>(
    input: CommitStep<Version, Scope>,
  ): Promise<void> {
    const step = structuredClone(input); const scope = step.checkpoint.scope;
    this.validateCheckpoint(step.checkpoint, step.lease);
    const hasComponentVersion = Boolean(step.checkpoint.candidateVersion || step.event?.candidateVersion ||
      step.receipt?.candidateVersion || step.projection?.value.candidateVersion);
    requireThat(Boolean(step.candidateVersion) === hasComponentVersion, 'CONFLICT');
    if (step.candidateVersion) {
      this.validateCandidateVersion(step.candidateVersion);
      this.sameCandidateVersion(step.candidateVersion, step.checkpoint.candidateVersion);
      if (step.event) this.sameCandidateVersion(step.candidateVersion, step.event.candidateVersion);
      if (step.receipt) this.sameCandidateVersion(step.candidateVersion, step.receipt.candidateVersion);
      if (step.projection) this.sameCandidateVersion(step.candidateVersion, step.projection.value.candidateVersion);
    }
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
    await this.storage.transaction(scope, async tx => {
      // An exact retry is read-only at the domain level and may be reconciled
      // after expiry. Any new write must pass the current lease fence.
      const run = await tx.get<RunState>('runs', step.checkpoint.runId);
      const existingEvent = step.event ? await tx.get<EventEnvelope>('events', step.event.eventId) : null;
      const existingReceipt = step.receipt ? await tx.get<OperationReceipt>('receipts', step.receipt.operationKey) : null;
      const project = await this.project(tx);
      const replay = run?.checkpoint && hash(run.checkpoint) === hash(step.checkpoint) &&
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
      await this.checkpoint(tx, step.checkpoint, step.lease);
      if (step.projection) await this.projection(tx, step.projection.value, step.projection.expectedRevision);
    });
  }
}
