import type {
  AgentContextPacket, MessageId, AgentId, AgentRole, ArtifactHash, CandidateHash, ChangeCheckVersion, CheckResult,
  CheckResultId, EventEnvelope, EventId, EvidenceId, EvidenceReference, LeaseToken, OperationKey,
  OperationReceipt, PersistenceAdapter, PolicyId, PolicyVersion, ProjectScope,
  RunId, StagedCandidate, ToolName, UserId,
} from '@context-plane/contracts';
import { roleToolAllowlists, toolNames } from '@context-plane/contracts';
import {
  inspectChange, authorizePublication, hashCheckResult, applyCoordinationRule, type ChangeAcknowledgement,
} from '@context-plane/core';
import { snapshotCandidateHash, type ExecutionProof } from '@context-plane/runner';
import { canonicalJson, sha256, mvp02Scenario, type ScenarioSnapshotId } from '@context-plane/scenario';
import { proposeCoordinationPolicy, evaluatePolicyCandidate, verifyPolicyActivation, type RuleProposalRecord, type RuleEvaluationRecord } from './policy-lifecycle.js';
import { plain, requireThat, safeKey, sameToken, validateArgs } from './validation.js';

export interface Credential {
  readonly token: string;
  readonly personId: UserId | string;
  readonly agentId: AgentId | string;
  readonly role: AgentRole;
  readonly sessionId: string;
  readonly allowedTools?: readonly ToolName[];
}
type Principal = Omit<Credential, 'token' | 'allowedTools'> & { readonly allowedTools: readonly ToolName[] };
export interface GatewayRunner {
  stage(snapshot: ScenarioSnapshotId, key: OperationKey | string): Promise<{ candidateHash: CandidateHash; directory: string }>;
  check(snapshot: ScenarioSnapshotId, key: OperationKey | string): Promise<ExecutionProof>;
  publish(snapshot: ScenarioSnapshotId, key: OperationKey | string, hash: CandidateHash | string): Promise<ExecutionProof>;
  reconcile(key: OperationKey | string): Promise<ExecutionProof | null>;
}
export interface HarnessOptions {
  readonly persistence: PersistenceAdapter;
  readonly runner: GatewayRunner;
  readonly scope: ProjectScope;
  readonly runId: RunId;
  readonly credentials: readonly Credential[];
  readonly controllerToken?: string;
  readonly crashAfterEffect?: (proof: ExecutionProof) => void | Promise<void>;
  readonly now?: () => Date;
}
export interface Command {
  readonly token: string;
  readonly tool: ToolName;
  readonly operationKey: string;
  readonly args: Record<string, unknown>;
  readonly scope?: ProjectScope;
}
interface Proposal { version: ChangeCheckVersion; snapshot: ScenarioSnapshotId; agentId: string }
interface Message {
  id: string; senderAgentId: string; recipientAgentId: string; body: string;
  evidenceIds: readonly string[]; version: ChangeCheckVersion | null;
}
interface DiagnosticPart { stagedCandidate: StagedCandidate; checkResult: CheckResult; artifacts: readonly { path: string; artifactHash: ArtifactHash }[] }
interface Diagnosis { baseline: DiagnosticPart; changed: DiagnosticPart; reverted: DiagnosticPart }
export interface HarnessState {
  dependencyRevision: number;
  policyEpoch: number;
  proposals: Record<string, Proposal>;
  latestProposalByAgent: Record<string, string>;
  staged: Record<string, StagedCandidate>;
  checks: Record<string, CheckResult>;
  messages: Message[];
  acknowledgements: ChangeAcknowledgement[];
  publications: string[];
  activePolicy: PolicyVersion | null;
  diagnosis: Diagnosis | null;
}
interface StoredPayload {
  operationKey: string; requestHash: string; principal: Principal | null; tool: string;
  phase: 'started' | 'finished'; result: Record<string, unknown>; state: HarnessState;
}
export interface CommandResult {
  operationKey: string; tool: string; result: Record<string, unknown>;
  eventId: string; receipt: OperationReceipt; replayed: boolean;
}
const snapshots: readonly ScenarioSnapshotId[] = ['baseline', 'dev-b-published', 'stale-candidate', 'combined-candidate'];
const implemented: readonly ToolName[] = ['get_project_context', 'read_operation', 'report_progress', 'send_agent_message',
  'propose_change', 'check_change', 'acknowledge_change', 'stage_change', 'run_checks', 'apply_change'];
const registeredChecks = ['consumer-integration'] as const;
const devA = mvp02Scenario.developers[0].agentId;
const devB = mvp02Scenario.developers[1].agentId;

/** Reference deterministic worker. Domain handlers are shared by direct calls and JSON HTTP. */
export function createHarness(options: HarnessOptions) {
  const scope = structuredClone(options.scope); const runId = options.runId;
  safeKey(scope.orgId); safeKey(scope.projectId); safeKey(runId);
  const credentials = options.credentials.map(value => {
    requireThat(value.token.length >= 16, 'INVALID_CREDENTIAL', 400);
    safeKey(value.personId); safeKey(value.agentId); safeKey(value.sessionId);
    return { ...value, allowedTools: [...(value.allowedTools ?? roleToolAllowlists[value.role])] };
  });
  requireThat(new Set(credentials.map(c => c.token)).size === credentials.length, 'DUPLICATE_CREDENTIAL', 400);
  requireThat(new Set(credentials.map(c => c.sessionId)).size === credentials.length, 'DUPLICATE_SESSION', 400);
  const time = () => (options.now?.() ?? new Date()).toISOString();
  let lease: LeaseToken | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work); tail = next.catch(() => {}); return next;
  };
  function principal(token: string): Principal {
    requireThat(typeof token === 'string', 'UNAUTHORIZED', 401);
    const found = credentials.find(value => sameToken(value.token, token));
    requireThat(found, 'UNAUTHORIZED', 401);
    const { token: _token, ...identity } = found; return identity;
  }
  function controller(token: string): void {
    requireThat(options.controllerToken && sameToken(options.controllerToken, token), 'UNAUTHORIZED', 401);
  }
  async function fence(): Promise<LeaseToken> {
    await history();
    if (lease) {
      const renewed = await options.persistence.renewLease(scope, lease);
      requireThat(renewed, 'LEASE_LOST'); lease = renewed;
    } else {
      lease = await options.persistence.acquireLease(scope, runId);
      requireThat(lease, 'RUN_LEASED');
    }
    return lease;
  }
  async function projectEvents(): Promise<readonly EventEnvelope[]> {
    let cursor = '000000'; const all: EventEnvelope[] = [];
    for (;;) {
      const page = await options.persistence.readEvents(scope, cursor);
      all.push(...page); if (page.length < 100) break;
      const next = page.at(-1)!.cursor; requireThat(next !== cursor, 'INVALID_EVENT_CURSOR'); cursor = next;
    }
    return all;
  }
  async function history(): Promise<readonly EventEnvelope<string, StoredPayload>[]> {
    // Reads and command replays must honor the same isolation boundary as writes.
    // Filtering another writer's events would fabricate the default revision 7.
    const projectHistory = await projectEvents();
    const projection = await options.persistence.readProjection(scope);
    requireThat(projectHistory.every(event => event.runId === runId && event.type.startsWith('harness.')) &&
      (!projection || (projectHistory.length > 0 && projection.runs.length === 1 &&
        projection.runs[0]!.runId === runId)), 'REFERENCE_PROJECT_IN_USE');
    return projectHistory as readonly EventEnvelope<string, StoredPayload>[];
  }
  async function state(): Promise<HarnessState> {
    const events = await history();
    return structuredClone(events.at(-1)?.payload.state ?? {
      dependencyRevision: mvp02Scenario.dependency.revision, policyEpoch: mvp02Scenario.policyEpoch,
      proposals: {}, latestProposalByAgent: {}, staged: {}, checks: {}, messages: [], acknowledgements: [], publications: [], activePolicy: null, diagnosis: null,
    });
  }
  function runnerKey(snapshot: ScenarioSnapshotId, suffix = '', version: ChangeCheckVersion | null = null): OperationKey {
    return `exec-${sha256(canonicalJson({ scope, runId, snapshot, suffix, version })).slice(7, 47)}` as OperationKey;
  }
  function snapshotFor(hash: unknown): ScenarioSnapshotId {
    const found = snapshots.find(id => snapshotCandidateHash(id) === hash);
    requireThat(found, 'UNREGISTERED_CHANGE', 400); return found;
  }
  function versionFor(args: Record<string, unknown>): ChangeCheckVersion {
    return { candidateHash: args.candidateHash as CandidateHash, dependencyRevision: args.dependencyRevision as number, policyEpoch: args.policyEpoch as number };
  }
  function owner(identity: Principal, snapshot: ScenarioSnapshotId): void {
    requireThat(snapshot !== 'baseline' && identity.agentId === (snapshot === 'dev-b-published' ? devB : devA), 'WRONG_CHANGE_OWNER', 403);
  }
  function inspection(current: HarnessState, version: ChangeCheckVersion) {
    const proposal = current.proposals[version.candidateHash];
    const policyApplies = current.activePolicy && proposal?.agentId === current.activePolicy.targetAgentId;
    const required = proposal?.snapshot === 'combined-candidate' || policyApplies ? [devB] : [];
    return { scope, runId, version, currentDependencyRevision: current.dependencyRevision,
      currentPolicyEpoch: current.policyEpoch, requiredAgentIds: required, acknowledgements: current.acknowledgements };
  }
  function decideChange(current: HarnessState, version: ChangeCheckVersion) {
    const decision = inspectChange(inspection(current, version));
    const proposal = current.proposals[version.candidateHash];
    if (!current.activePolicy || proposal?.agentId !== current.activePolicy.targetAgentId) return decision;
    const policyDecision = applyCoordinationRule(current.activePolicy.rule, {
      caseId: 'current-request', changeKind: 'unit_change', dependencyRevision: current.dependencyRevision,
      candidateDependencyRevision: version.dependencyRevision, requiredAgentIds: [devB],
      acknowledgements: current.acknowledgements.filter(a => canonicalJson(a.version) === canonicalJson(version)), observedFailure: null,
    });
    return { allowed: decision.allowed && policyDecision.decision !== 'block',
      reasons: [...new Set([...decision.reasons, ...policyDecision.reasons])], policyDecision };
  }
  function evidence(proof: ExecutionProof): EvidenceReference[] {
    return proof.evidenceIds.map(evidenceId => ({ evidenceId, kind: 'registered-check', contentHash: proof.resultHash }));
  }
  function staged(snapshot: ScenarioSnapshotId, version: ChangeCheckVersion, key: OperationKey, revision: number): StagedCandidate {
    return { scope, runId, revision, version, operationKey: key,
      artifactHashes: mvp02Scenario.snapshots[snapshot].map(a => a.artifactHash), evidence: [], stagedAt: time() };
  }
  function checked(stage: StagedCandidate, proof: ExecutionProof): CheckResult {
    validateProof(stage, proof, false);
    return { scope, runId, checkResultId: `check-${sha256(proof.resultHash).slice(7, 31)}` as CheckResultId,
      revision: 1, stagedCandidateRevision: stage.revision, version: stage.version,
      registeredChecks, passed: proof.passed, evidence: evidence(proof), completedAt: time() };
  }
  function validateProof(stage: StagedCandidate, proof: ExecutionProof, publication: boolean): void {
    const { resultHash, ...body } = proof;
    const expectedSnapshot = snapshotFor(stage.version.candidateHash);
    requireThat(proof.candidateHash === stage.version.candidateHash && proof.operationKey === stage.operationKey &&
      proof.snapshotId === expectedSnapshot && proof.passed === (proof.exitCode === 0) &&
      canonicalJson(proof.registeredChecks) === canonicalJson(registeredChecks) &&
      canonicalJson(proof.artifacts) === canonicalJson(mvp02Scenario.snapshots[expectedSnapshot].map(({ path, artifactHash }) => ({ path, artifactHash }))) &&
      Array.isArray(proof.evidenceIds) && proof.evidenceIds.length > 0 &&
      typeof proof.output === 'string' && Buffer.byteLength(proof.output) <= 16384 &&
      resultHash === sha256(canonicalJson(body)), 'INVALID_RUNNER_PROOF');
    requireThat(publication ? proof.published === true && proof.passed && typeof proof.publicationPath === 'string' : proof.published === undefined,
      'INVALID_RUNNER_PROOF');
  }
  async function commit(payload: StoredPayload, status: 'started' | 'succeeded', version?: ChangeCheckVersion): Promise<CommandResult> {
    const activeLease = await fence();
    const oldCheckpoint = await options.persistence.readCheckpoint(scope, runId);
    const oldProjection = await options.persistence.readProjection(scope);
    const priorReceipt = await options.persistence.readReceipt(scope, payload.operationKey as OperationKey);
    // Cursor is project-wide; the projection advances atomically on every gateway event.
    const cursor = Number((await projectEvents()).at(-1)?.cursor ?? '0') + 1;
    const revision = (oldCheckpoint?.revision ?? 0) + 1;
    const event: EventEnvelope<string, StoredPayload> = {
      eventId: `evt-${sha256(canonicalJson({ runId, operation: payload.operationKey, status })).slice(7, 47)}` as EventId,
      type: `harness.${payload.tool}.${payload.phase}`, scope, runId,
      actor: payload.principal ? { kind: 'agent', id: payload.principal.agentId as AgentId, role: payload.principal.role } : { kind: 'system', id: 'system', role: 'system' },
      revision, cursor: String(cursor).padStart(6, '0'), occurredAt: time(), payload,
      ...(version ? { candidateVersion: version } : {}),
    };
    const resultEvidence = Array.isArray(payload.result.evidenceIds) ? payload.result.evidenceIds as EvidenceId[] : [];
    const receipt: OperationReceipt = {
      scope, runId, operationKey: payload.operationKey as OperationKey, kind: payload.tool, status, attempt: 1,
      leaseGeneration: activeLease.generation, evidenceIds: resultEvidence,
      startedAt: priorReceipt?.startedAt ?? event.occurredAt,
      ...(status === 'succeeded' ? { completedAt: time(), resultHash: sha256(canonicalJson(payload.result)) } : {}),
      ...(version ? { candidateVersion: version } : {}),
    };
    const completed = [...(oldCheckpoint?.completedOperationKeys ?? [])];
    if (status === 'succeeded' && !completed.includes(receipt.operationKey)) completed.push(receipt.operationKey);
    requireThat(completed.length <= 100, 'RUN_BUDGET_EXCEEDED');
    await options.persistence.commitStep({ lease: activeLease,
      checkpoint: { scope, runId, checkpointId: `checkpoint-${runId}`, revision, leaseGeneration: activeLease.generation,
        status: payload.state.publications.includes(snapshotCandidateHash('combined-candidate')) ? 'completed' : 'running',
        lastEventCursor: event.cursor, nextAction: status === 'started' ? payload.tool : null,
        completedOperationKeys: completed, updatedAt: time(), ...(version ? { candidateVersion: version } : {}) },
      event, receipt,
      projection: { expectedRevision: oldProjection?.revision ?? 0, value: { scope,
        revision: (oldProjection?.revision ?? 0) + 1, eventCursor: event.cursor, policyEpoch: payload.state.policyEpoch,
        runs: [{ runId, ownerAgentId: devA, status: payload.state.publications.includes(snapshotCandidateHash('combined-candidate')) ? 'completed' : 'running',
          summary: 'Deterministic two-agent migration', blocker: null, checkpointRevision: revision, evidenceIds: resultEvidence }],
        activePolicy: payload.state.activePolicy,
        accessRequests: [], dependencies: oldProjection?.dependencies ?? [],
        addressedMessages: oldProjection?.addressedMessages ?? [], timeline: [],
        ...(version ? { candidateVersion: version } : {}) } },
      ...(version ? { candidateVersion: version } : {}),
    });
    return { operationKey: payload.operationKey, tool: payload.tool, result: payload.result, eventId: event.eventId, receipt, replayed: false };
  }
  async function prior(operationKey: string, requestHash: string): Promise<CommandResult | null> {
    const events = (await history()).filter(e => e.payload.operationKey === operationKey);
    for (const event of events) requireThat(event.payload.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT');
    const terminal = events.find(e => e.payload.phase === 'finished');
    if (!terminal) return null;
    const receipt = await options.persistence.readReceipt(scope, operationKey as OperationKey);
    requireThat(receipt?.status === 'succeeded', 'INCONSISTENT_RECEIPT');
    return { operationKey, tool: terminal.payload.tool, result: structuredClone(terminal.payload.result), eventId: terminal.eventId, receipt, replayed: true };
  }
  async function context(token: string) {
    const identity = principal(token); const current = await state();
    const activePolicy = current.activePolicy?.targetAgentId === identity.agentId ? current.activePolicy : null;
    const agentContext: AgentContextPacket = {
      scope, role: identity.role, agentId: identity.agentId as AgentId,
      task: identity.agentId === devA ? mvp02Scenario.staleCandidate.summary : 'Coordinate the Billing dependency.',
      dependencyRevision: current.dependencyRevision, policyEpoch: current.policyEpoch, activePolicy,
      addressedMessages: current.messages.filter(m => m.recipientAgentId === identity.agentId).map(m => ({
        messageId: m.id as MessageId, senderAgentId: m.senderAgentId as AgentId, recipientAgentId: m.recipientAgentId as AgentId,
        body: m.body, dependencyRevision: m.version?.dependencyRevision ?? current.dependencyRevision,
        evidenceIds: m.evidenceIds as readonly EvidenceId[],
      })),
      evidenceIds: activePolicy?.evidence.map(e => e.evidenceId) ?? [],
      allowedTools: identity.allowedTools.filter(t => implemented.includes(t)),
    };
    return { scope, runId, identity, agentContext, dependencyRevision: current.dependencyRevision, policyEpoch: current.policyEpoch,
      mode: 'deterministic-reference', transport: 'http-json-not-mcp',
      messages: current.messages.filter(m => m.senderAgentId === identity.agentId || m.recipientAgentId === identity.agentId),
      ownChanges: Object.values(current.proposals).filter(p => p.agentId === identity.agentId),
      activePolicy: current.activePolicy?.targetAgentId === identity.agentId ? current.activePolicy : null,
      publications: current.publications,
      availableTools: identity.allowedTools.filter(t => implemented.includes(t)),
      observationCoverage: 'Only explicit domain operations; no local host monitoring.' };
  }
  async function execute(command: Command): Promise<CommandResult | Record<string, unknown>> {
    const identity = principal(command.token);
    plain(command.args); safeKey(command.operationKey);
    requireThat(Object.keys(command).every(k => ['token', 'tool', 'operationKey', 'args', 'scope'].includes(k)), 'INVALID_INPUT', 400);
    requireThat(toolNames.includes(command.tool) && implemented.includes(command.tool) && identity.allowedTools.includes(command.tool), 'TOOL_FORBIDDEN', 403);
    if (command.scope) requireThat(command.scope.orgId === scope.orgId && command.scope.projectId === scope.projectId, 'SCOPE_FORBIDDEN', 403);
    validateArgs(command.tool, command.args);
    if (command.tool === 'get_project_context') return context(command.token);
    if (command.tool === 'read_operation') {
      const key = command.args.operationKey as string;
      const event = (await history()).find(e => e.payload.operationKey === key);
      requireThat(event?.payload.principal?.agentId === identity.agentId, 'OPERATION_FORBIDDEN', 403);
      return { receipt: await options.persistence.readReceipt(scope, key as OperationKey) };
    }
    return serial(async () => {
      const requestHash = sha256(canonicalJson({ tool: command.tool, args: command.args, agentId: identity.agentId, personId: identity.personId, scope, runId }));
      const replay = await prior(command.operationKey, requestHash); if (replay) return replay;
      await fence();
      const current = await state(); const args = command.args;
      const payload = (phase: StoredPayload['phase'], result: Record<string, unknown>): StoredPayload => ({
        operationKey: command.operationKey, requestHash, principal: identity, tool: command.tool, phase, result, state: current,
      });
      let result: Record<string, unknown>; let version: ChangeCheckVersion | undefined;
      const hash = args.candidateHash as string | undefined;
      if (hash) {
        const events = await history();
        const pendingPublication = events.find(e => e.payload.tool === 'apply_change' && e.payload.phase === 'started' &&
          e.candidateVersion?.candidateHash === hash &&
          !events.some(terminal => terminal.payload.operationKey === e.payload.operationKey && terminal.payload.phase === 'finished'));
        requireThat(!pendingPublication || pendingPublication.payload.operationKey === command.operationKey, 'PUBLICATION_PENDING');
      }
      if (command.tool === 'report_progress') {
        result = { reported: true, independentlyVerified: false, summary: args.summary, evidenceIds: args.evidenceIds };
      } else if (command.tool === 'send_agent_message') {
        requireThat(credentials.some(c => c.agentId === args.recipientAgentId), 'UNKNOWN_RECIPIENT', 400);
        const own = current.proposals[current.latestProposalByAgent?.[identity.agentId] ?? ''];
        const message: Message = { id: `message-${command.operationKey}`, senderAgentId: identity.agentId,
          recipientAgentId: args.recipientAgentId as string, body: args.body as string,
          evidenceIds: args.evidenceIds as string[], version: own?.version ?? null };
        current.messages.push(message); result = { message };
      } else if (command.tool === 'propose_change') {
        const snapshot = snapshotFor(hash); owner(identity, snapshot); version = versionFor(args);
        const declaredDependencyRevision = snapshot === 'combined-candidate' ? 8 : 7;
        requireThat(version.dependencyRevision === declaredDependencyRevision, 'DECLARED_DEPENDENCY_MISMATCH');
        current.proposals[hash!] = { snapshot, version, agentId: identity.agentId };
        current.latestProposalByAgent ??= {};
        current.latestProposalByAgent[identity.agentId] = hash!;
        result = { ...decideChange(current, version), version, snapshot };
      } else if (command.tool === 'check_change') {
        version = versionFor(args); const proposal = current.proposals[hash!];
        requireThat(proposal && proposal.agentId === identity.agentId, 'UNKNOWN_CHANGE', 403);
        requireThat(canonicalJson(version) === canonicalJson(proposal.version), 'CHANGE_VERSION_MISMATCH');
        result = { ...decideChange(current, version), version };
      } else if (command.tool === 'acknowledge_change') {
        requireThat(identity.agentId === devB, 'ACKNOWLEDGER_FORBIDDEN', 403);
        const proposal = current.proposals[hash!]; requireThat(proposal, 'UNKNOWN_CHANGE'); version = proposal.version;
        requireThat(current.messages.some(m => m.recipientAgentId === identity.agentId && m.version && canonicalJson(m.version) === canonicalJson(version)), 'NO_ADDRESSED_REQUEST');
        requireThat(args.acknowledgement === 'patched' || args.acknowledgement === 'no-change', 'INVALID_ACKNOWLEDGEMENT', 400);
        requireThat(version.dependencyRevision === current.dependencyRevision && version.policyEpoch === current.policyEpoch, 'STALE_ACKNOWLEDGEMENT');
        const acknowledgement: ChangeAcknowledgement = { scope, runId, version, agentId: identity.agentId as AgentId,
          dependencyRevision: version.dependencyRevision, outcome: args.acknowledgement };
        current.acknowledgements = current.acknowledgements.filter(a => a.agentId !== identity.agentId || a.version.candidateHash !== hash);
        current.acknowledgements.push(acknowledgement);
        result = { acknowledgement, independentlyVerified: false, verification: 'Addressed actor acknowledgement; actual compatibility is established by registered checks.' };
      } else {
        const proposal = current.proposals[hash!]; requireThat(proposal, 'UNKNOWN_CHANGE'); owner(identity, proposal.snapshot);
        version = proposal.version;
        if (command.tool === 'apply_change') {
          requireThat(args.operationKey === command.operationKey, 'OPERATION_KEY_MISMATCH', 400);
          requireThat(canonicalJson(versionFor(args)) === canonicalJson(version), 'CHANGE_VERSION_MISMATCH');
        }
        const key = runnerKey(proposal.snapshot, '', version);
        const pending = (await history()).find(e => e.payload.operationKey === command.operationKey && e.payload.phase === 'started');
        // A publication proof is authoritative for recovery after effect/before database commit.
        const recovered = command.tool === 'apply_change' ? await options.runner.reconcile(key) : null;
        if (command.tool === 'apply_change') {
          requireThat(!current.publications.includes(hash!), 'ALREADY_PUBLISHED');
          if (recovered) {
            const savedAuthorization = pending?.payload.result.authorization as { allowed?: boolean } | undefined;
            requireThat(pending?.payload.tool === 'apply_change' && savedAuthorization?.allowed === true &&
              pending.payload.result.runnerOperationKey === key &&
              canonicalJson(pending.candidateVersion) === canonicalJson(version) &&
              recovered.operationKey === key && recovered.snapshotId === proposal.snapshot, 'NO_MATCHING_PUBLICATION_INTENT');
          }
        }
        if (!recovered) {
          const decision = decideChange(current, version);
          requireThat(decision.allowed, `CHANGE_REJECTED:${decision.reasons.join(',')}`);
        }
        if (command.tool === 'stage_change') {
          const expected = mvp02Scenario.snapshots[proposal.snapshot].map(a => a.artifactHash).sort();
          requireThat(canonicalJson([...(args.artifactHashes as string[])].sort()) === canonicalJson(expected), 'ARTIFACT_SET_MISMATCH');
          if (!(await history()).some(e => e.payload.operationKey === command.operationKey)) await commit(payload('started', { runnerOperationKey: key }), 'started', version);
          await options.runner.stage(proposal.snapshot, key);
          const stage = staged(proposal.snapshot, version, key, (current.staged[hash!]?.revision ?? 0) + 1);
          current.staged[hash!] = stage; delete current.checks[hash!]; result = { stagedCandidate: stage };
        } else if (command.tool === 'run_checks') {
          const stage = current.staged[hash!]; requireThat(stage, 'NOT_STAGED');
          requireThat(canonicalJson(args.registeredCommands) === canonicalJson(registeredChecks), 'UNREGISTERED_CHECK', 400);
          if (!(await history()).some(e => e.payload.operationKey === command.operationKey)) await commit(payload('started', { runnerOperationKey: key }), 'started', version);
          const proof = await options.runner.check(proposal.snapshot, key);
          const check = checked(stage, proof); current.checks[hash!] = check;
          result = { checkResult: check, proof, evidenceIds: proof.evidenceIds };
        } else {
          const stage = current.staged[hash!]; const check = current.checks[hash!]; requireThat(stage && check, 'CHECKS_REQUIRED');
          const authorization = recovered ? pending!.payload.result.authorization as ReturnType<typeof authorizePublication> : authorizePublication({ ...inspection(current, version), stagedCandidate: stage,
            checkResult: check, registeredChecks, expectedCheckResultHash: hashCheckResult(check) });
          if (!recovered) requireThat(authorization.allowed, `PUBLICATION_REJECTED:${authorization.reasons.join(',')}`);
          requireThat(!recovered || recovered.candidateHash === hash, 'RECEIPT_HASH_MISMATCH');
          if (!(await history()).some(e => e.payload.operationKey === command.operationKey)) await commit(payload('started', { authorization, runnerOperationKey: key }), 'started', version);
          await fence();
          const proof = recovered ?? await options.runner.publish(proposal.snapshot, key, version.candidateHash);
          validateProof(stage, proof, true);
          if (!recovered) await options.crashAfterEffect?.(proof);
          if (!current.publications.includes(hash!)) current.publications.push(hash!);
          if (proposal.snapshot === 'dev-b-published') current.dependencyRevision = mvp02Scenario.devBPublication.dependencyRevision;
          result = { published: true, reconciled: Boolean(recovered), proof, authorization, evidenceIds: proof.evidenceIds };
        }
      }
      return commit(payload('finished', result), 'succeeded', version);
    });
  }
  async function diagnoseFailure(token: string, operationKey: string): Promise<CommandResult> {
    controller(token); safeKey(operationKey);
    return serial(async () => {
      const requestHash = sha256(canonicalJson({ controller: 'diagnose', operationKey, scope, runId }));
      const replay = await prior(operationKey, requestHash); if (replay) return replay;
      await fence(); const current = await state(); requireThat(current.dependencyRevision === 8, 'DEPENDENCY_NOT_PUBLISHED');
      if (!(await history()).some(e => e.payload.operationKey === operationKey)) {
        await commit({ operationKey, requestHash, principal: null, tool: 'diagnose', phase: 'started', state: current,
          result: { mode: 'controlled-diagnostic-not-publication' } }, 'started');
      }
      const parts: DiagnosticPart[] = [];
      for (const [snapshot, suffix] of [['dev-b-published', 'baseline'], ['stale-candidate', 'changed'], ['dev-b-published', 'reverted']] as const) {
        const key = runnerKey(snapshot, `diagnostic-${operationKey}-${suffix}`);
        await fence(); await options.runner.stage(snapshot, key); const proof = await options.runner.check(snapshot, key);
        const version = { candidateHash: snapshotCandidateHash(snapshot), dependencyRevision: snapshot === 'stale-candidate' ? 7 : 8, policyEpoch: current.policyEpoch };
        const stage = staged(snapshot, version, key, 1);
        parts.push({ stagedCandidate: stage, checkResult: checked(stage, proof), artifacts: proof.artifacts });
      }
      current.diagnosis = { baseline: parts[0]!, changed: parts[1]!, reverted: parts[2]! };
      requireThat(parts[0]!.checkResult.passed && !parts[1]!.checkResult.passed && parts[2]!.checkResult.passed, 'CAUSAL_CHECK_FAILED');
      return commit({ operationKey, requestHash, principal: null, tool: 'diagnose', phase: 'finished', state: current,
        result: { diagnosis: current.diagnosis, evidenceIds: parts.flatMap(p => p.checkResult.evidence.map(e => e.evidenceId)) } }, 'succeeded');
    });
  }
  // Each lifecycle transition has its own immutable event and receipt. The wrapper
  // below resumes these operations instead of folding evaluation into activation.
  async function lifecycleRecord<T>(operationKey: string, tool: string): Promise<{ eventId: EventId; record: T }> {
    const event = (await history()).find(e => e.payload.operationKey === operationKey && e.payload.phase === 'finished');
    requireThat(event?.payload.tool === tool, 'POLICY_RECORD_NOT_FOUND');
    const receipt = await options.persistence.readReceipt(scope, operationKey as OperationKey);
    requireThat(receipt?.status === 'succeeded', 'INCONSISTENT_RECEIPT');
    return { eventId: event.eventId, record: event.payload.result.record as T };
  }
  async function proposeRule(token: string, operationKey: string): Promise<CommandResult> {
    controller(token); safeKey(operationKey);
    return serial(async () => {
      const requestHash = sha256(canonicalJson({ controller: 'policy-propose', operationKey, scope, runId }));
      const replay = await prior(operationKey, requestHash); if (replay) return replay;
      await fence(); const current = await state(); requireThat(current.diagnosis, 'DIAGNOSIS_REQUIRED');
      const diagnosisEvent = [...await history()].reverse().find(e => e.payload.tool === 'diagnose' && e.payload.phase === 'finished');
      requireThat(diagnosisEvent, 'DIAGNOSIS_REQUIRED');
      const record = proposeCoordinationPolicy(scope, current.policyEpoch, current.diagnosis,
        diagnosisEvent.eventId, time());
      return commit({ operationKey, requestHash, principal: null, tool: 'policy_proposed', phase: 'finished', state: current,
        result: { record, evidenceIds: record.candidate.evidence.map(e => e.evidenceId) } }, 'succeeded');
    });
  }
  async function evaluateRule(token: string, operationKey: string, proposalOperationKey: string): Promise<CommandResult> {
    controller(token); safeKey(operationKey); safeKey(proposalOperationKey);
    return serial(async () => {
      const requestHash = sha256(canonicalJson({ controller: 'policy-evaluate', proposalOperationKey, scope, runId }));
      const replay = await prior(operationKey, requestHash); if (replay) return replay;
      await fence(); const current = await state();
      const proposal = await lifecycleRecord<RuleProposalRecord>(proposalOperationKey, 'policy_proposed');
      const record = evaluatePolicyCandidate(proposal.record, proposal.eventId, time());
      // Failed evaluations are evidence too. They never change the active pointer.
      return commit({ operationKey, requestHash, principal: null, tool: 'policy_evaluated', phase: 'finished', state: current,
        result: { record, evidenceIds: proposal.record.candidate.evidence.map(e => e.evidenceId) } }, 'succeeded');
    });
  }
  async function activateRule(token: string, operationKey: string, evaluationOperationKey: string): Promise<CommandResult> {
    controller(token); safeKey(operationKey); safeKey(evaluationOperationKey);
    return serial(async () => {
      const requestHash = sha256(canonicalJson({ controller: 'policy-activate', evaluationOperationKey, scope, runId }));
      const replay = await prior(operationKey, requestHash); if (replay) return replay;
      await fence(); const current = await state();
      const evaluated = await lifecycleRecord<RuleEvaluationRecord>(evaluationOperationKey, 'policy_evaluated');
      const proposalEvent = (await history()).find(e => e.eventId === evaluated.record.proposalEventId && e.payload.tool === 'policy_proposed');
      requireThat(proposalEvent, 'POLICY_RECORD_NOT_FOUND');
      const proposal = proposalEvent.payload.result.record as RuleProposalRecord;
      verifyPolicyActivation(proposal, evaluated.record, proposalEvent.eventId);
      const candidate = proposal.candidate;
      const alreadyActive = current.activePolicy?.policyHash === candidate.policyHash &&
        current.activePolicy.datasetHash === candidate.datasetHash && current.activePolicy.targetAgentId === candidate.targetAgentId;
      let policy = current.activePolicy;
      if (!alreadyActive) {
        requireThat(current.policyEpoch === candidate.basePolicyEpoch, 'STALE_POLICY_EPOCH');
        policy = { scope, policyId: `policy-${sha256(proposalEvent.eventId).slice(7, 39)}` as PolicyId,
          targetAgentId: candidate.targetAgentId, policyHash: candidate.policyHash,
          revision: (current.activePolicy?.revision ?? 0) + 1, policyEpoch: current.policyEpoch + 1,
          datasetHash: candidate.datasetHash, rule: candidate.rule, evidence: candidate.evidence, promotedAt: time() };
        current.policyEpoch = policy.policyEpoch; current.activePolicy = policy;
      }
      return commit({ operationKey, requestHash, principal: null, tool: 'policy_activated', phase: 'finished', state: current,
        result: { policy, alreadyActive, proposalEventId: proposalEvent.eventId, evaluationEventId: evaluated.eventId,
          evaluation: evaluated.record.evaluation, evidenceIds: candidate.evidence.map(e => e.evidenceId),
          proposalMode: proposal.proposalMode } }, 'succeeded');
    });
  }
  async function learnFromFailure(token: string, operationKey: string): Promise<CommandResult> {
    controller(token); safeKey(operationKey);
    const requestHash = sha256(canonicalJson({ controller: 'learn', operationKey, scope, runId }));
    const replay = await prior(operationKey, requestHash); if (replay) return replay;
    const key = (phase: string) => `policy-${phase}-${sha256(canonicalJson({ scope, runId, operationKey })).slice(7, 47)}`;
    await proposeRule(token, key('propose'));
    await evaluateRule(token, key('evaluate'), key('propose'));
    const activated = await activateRule(token, key('activate'), key('evaluate'));
    return serial(async () => {
      const replay = await prior(operationKey, requestHash); if (replay) return replay;
      await fence();
      return commit({ operationKey, requestHash, principal: null, tool: 'learn', phase: 'finished', state: await state(),
        result: { ...activated.result, activationEventId: activated.eventId,
          comparison: 'Static coordination gate is retained; no improvement over an equivalent static gate is claimed.' } }, 'succeeded');
    });
  }
  return { execute, context, diagnoseFailure, learnFromFailure, proposeRule, evaluateRule, activateRule,
    controllerState: async (token: string) => { controller(token); return state(); } };
}
export type Harness = ReturnType<typeof createHarness>;
