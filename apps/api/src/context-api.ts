import type {
  AddressedMessage,
  AgentContextPacket,
  AgentId,
  ArtifactHash,
  CommandId,
  DependencyId,
  EventEnvelope,
  EventId,
  EvidenceId,
  MessageId,
  PersistenceAdapter,
  ProjectId,
  ProjectProjection,
  RunId,
  UserId,
} from "@context-plane/contracts";
import { roleToolAllowlists, type AgentRole } from "@context-plane/contracts";
import { PersistenceError } from "@context-plane/persistence";
import { mvp02Scenario, sha256 } from "@context-plane/scenario";

export type DemoSessionId = "dev-a" | "dev-b";

interface DemoIdentity {
  readonly userId: UserId;
  readonly agentId: AgentId;
  readonly role: AgentRole;
}

export interface PublishDependencyInput {
  readonly commandId: CommandId;
  readonly idempotencyKey: string;
  readonly expectedRevision: number;
  readonly dependencyId: DependencyId;
  readonly dependencyRevision: number;
  readonly artifactHash: ArtifactHash;
  readonly evidenceId: EvidenceId;
  readonly publishedAt: string;
}

export interface PublicationResult {
  readonly replayed: boolean;
  readonly event: EventEnvelope<"dependency.published", DependencyPublishedPayload>;
  readonly projection: ProjectProjection;
}

interface DependencyPublishedPayload {
  readonly commandId: CommandId;
  readonly idempotencyKey: string;
  readonly dependencyId: DependencyId;
  readonly dependencyRevision: number;
  readonly artifactHash: ArtifactHash;
  readonly evidenceIds: readonly EvidenceId[];
}

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const [devA, devB] = mvp02Scenario.developers;
if (!devA || !devB) throw new Error("MVP-02 identities are incomplete");

const sessions: Readonly<Record<DemoSessionId, DemoIdentity>> = {
  "dev-a": { userId: devA.userId, agentId: devA.agentId, role: "orders" },
  "dev-b": { userId: devB.userId, agentId: devB.agentId, role: "billing" },
};

const publicationRunId = "run_mvp_03_dev_b_publication" as RunId;

function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new ApiError(400, "INVALID_INPUT");
  }
}

function assertInteger(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ApiError(400, "INVALID_INPUT");
  }
}

function initialProjection(): ProjectProjection {
  const baseline = mvp02Scenario.dependencyRevisions[0];
  if (!baseline) throw new ApiError(500, "SCENARIO_INVALID");
  return {
    scope: mvp02Scenario.scope,
    revision: 1,
    eventCursor: "000000",
    policyEpoch: mvp02Scenario.policyEpoch,
    runs: [],
    accessRequests: [],
    dependencies: [{
      dependencyId: baseline.dependencyId,
      providerServiceId: mvp02Scenario.dependency.providerServiceId,
      consumerServiceId: mvp02Scenario.dependency.consumerServiceId,
      revision: baseline.revision,
      artifactHash: baseline.artifactHash,
      evidenceIds: baseline.evidence.map(({ evidenceId }) => evidenceId),
    }],
    addressedMessages: [],
    timeline: [],
  };
}

function sameProject(projectId: string): boolean {
  return projectId === mvp02Scenario.scope.projectId;
}

function formatCursor(value: number): string {
  return String(value).padStart(6, "0");
}

function eventIdFor(idempotencyKey: string): EventId {
  return `event:${sha256(`${mvp02Scenario.scope.orgId}:${mvp02Scenario.scope.projectId}:${idempotencyKey}`)}` as EventId;
}

function publicationMessage(payload: DependencyPublishedPayload): AddressedMessage {
  return {
    messageId: `message:${payload.commandId}` as MessageId,
    senderAgentId: devB.agentId,
    recipientAgentId: devA.agentId,
    body: `Billing published dependency revision ${payload.dependencyRevision}; re-check the Orders candidate before staging.`,
    dependencyRevision: payload.dependencyRevision,
    evidenceIds: payload.evidenceIds,
  };
}

function publishedProjection(
  previous: ProjectProjection,
  event: EventEnvelope<"dependency.published", DependencyPublishedPayload>,
): ProjectProjection {
  const message = publicationMessage(event.payload);
  return {
    ...previous,
    revision: previous.revision + 1,
    eventCursor: event.cursor,
    dependencies: [{
      dependencyId: event.payload.dependencyId,
      providerServiceId: mvp02Scenario.dependency.providerServiceId,
      consumerServiceId: mvp02Scenario.dependency.consumerServiceId,
      revision: event.payload.dependencyRevision,
      artifactHash: event.payload.artifactHash,
      evidenceIds: event.payload.evidenceIds,
    }],
    addressedMessages: [...previous.addressedMessages.filter(({ messageId }) => messageId !== message.messageId), message],
    timeline: [...previous.timeline, {
      eventId: event.eventId,
      cursor: event.cursor,
      type: event.type,
      summary: `Dev B published dependency revision ${event.payload.dependencyRevision}.`,
      evidenceIds: event.payload.evidenceIds,
    }],
  };
}

function translatePersistenceError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof PersistenceError) {
    if (error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT") {
      throw new ApiError(409, error.code);
    }
    if (error.code === "INVALID_INPUT") throw new ApiError(400, error.code);
    throw new ApiError(503, error.code);
  }
  throw new ApiError(500, "INTERNAL_ERROR");
}

export class ContextApi {
  constructor(private readonly persistence: PersistenceAdapter) {}

  async initialize(): Promise<void> {
    const current = await this.persistence.readProjection(mvp02Scenario.scope);
    if (current) return;
    try {
      await this.persistence.saveProjection(initialProjection(), 0);
    } catch (error) {
      const raced = await this.persistence.readProjection(mvp02Scenario.scope);
      if (!raced) translatePersistenceError(error);
    }
  }

  authenticate(sessionId: string | null): DemoIdentity {
    if (!sessionId || !(sessionId in sessions)) throw new ApiError(401, "UNAUTHENTICATED");
    return sessions[sessionId as DemoSessionId];
  }

  authorizeProject(projectId: string): void {
    if (!sameProject(projectId)) throw new ApiError(403, "PROJECT_SCOPE_MISMATCH");
  }

  async getContext(
    identity: DemoIdentity,
    projectId: string,
    requestedAgentId?: string,
  ): Promise<AgentContextPacket> {
    this.authorizeProject(projectId);
    if (requestedAgentId !== undefined && requestedAgentId !== identity.agentId) {
      throw new ApiError(403, "AGENT_SCOPE_MISMATCH");
    }
    const projection = await this.persistence.readProjection(mvp02Scenario.scope);
    if (!projection) throw new ApiError(500, "PROJECT_NOT_INITIALIZED");
    const dependency = projection.dependencies.find(({ dependencyId }) =>
      dependencyId === mvp02Scenario.dependency.dependencyId);
    if (!dependency) throw new ApiError(500, "DEPENDENCY_NOT_FOUND");
    const addressedMessages = projection.addressedMessages.filter(({ recipientAgentId }) =>
      recipientAgentId === identity.agentId);
    const evidenceIds = [...new Set([
      ...dependency.evidenceIds,
      ...addressedMessages.flatMap(({ evidenceIds: ids }) => ids),
    ])];
    return {
      scope: projection.scope,
      role: identity.role,
      agentId: identity.agentId,
      task: identity.agentId === devA.agentId
        ? mvp02Scenario.staleCandidate.summary
        : "Publish the synthetic Billing artifact and notify its dependent owner.",
      dependencyRevision: dependency.revision,
      addressedMessages,
      evidenceIds,
      allowedTools: roleToolAllowlists[identity.role],
      policyEpoch: projection.policyEpoch,
    };
  }

  async getProjection(identity: DemoIdentity, projectId: string): Promise<ProjectProjection> {
    void identity;
    this.authorizeProject(projectId);
    const projection = await this.persistence.readProjection(mvp02Scenario.scope);
    if (!projection) throw new ApiError(404, "PROJECT_NOT_FOUND");
    return projection;
  }

  async getEvents(identity: DemoIdentity, projectId: string, after?: string): Promise<readonly EventEnvelope[]> {
    void identity;
    this.authorizeProject(projectId);
    try {
      return await this.persistence.readEvents(mvp02Scenario.scope, after);
    } catch (error) {
      return translatePersistenceError(error);
    }
  }

  async publishDependency(
    identity: DemoIdentity,
    projectId: string,
    input: PublishDependencyInput,
  ): Promise<PublicationResult> {
    this.authorizeProject(projectId);
    if (identity.agentId !== devB.agentId) throw new ApiError(403, "PUBLICATION_FORBIDDEN");
    assertIdentifier(input?.commandId);
    assertIdentifier(input?.idempotencyKey);
    assertInteger(input?.expectedRevision);
    assertIdentifier(input?.dependencyId);
    assertInteger(input?.dependencyRevision, 1);
    assertIdentifier(input?.artifactHash);
    assertIdentifier(input?.evidenceId);
    if (typeof input?.publishedAt !== "string" || !Number.isFinite(Date.parse(input.publishedAt))) {
      throw new ApiError(400, "INVALID_INPUT");
    }
    const fixture = mvp02Scenario.devBPublication;
    if (input.dependencyId !== mvp02Scenario.dependency.dependencyId ||
      input.dependencyRevision !== fixture.dependencyRevision ||
      input.artifactHash !== fixture.artifact.artifactHash ||
      input.evidenceId !== fixture.evidence.evidenceId) {
      throw new ApiError(400, "PUBLICATION_FIXTURE_MISMATCH");
    }
    try {
      const existingEvents = await this.persistence.readEvents(mvp02Scenario.scope);
      const id = eventIdFor(input.idempotencyKey);
      const existing = existingEvents.find(({ eventId }) => eventId === id);
      const payload: DependencyPublishedPayload = {
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
        dependencyId: input.dependencyId,
        dependencyRevision: input.dependencyRevision,
        artifactHash: input.artifactHash,
        evidenceIds: [input.evidenceId],
      };
      const event: EventEnvelope<"dependency.published", DependencyPublishedPayload> = {
        eventId: id,
        type: "dependency.published",
        scope: mvp02Scenario.scope,
        runId: publicationRunId,
        actor: { kind: "agent", id: identity.agentId, role: identity.role },
        revision: existing?.revision ?? existingEvents.length + 1,
        cursor: existing?.cursor ?? formatCursor(existingEvents.length + 1),
        occurredAt: input.publishedAt,
        payload,
      };
      if (existing) {
        await this.persistence.appendEvent(event);
        const projection = await this.persistence.readProjection(mvp02Scenario.scope);
        if (!projection) throw new ApiError(500, "PROJECT_NOT_INITIALIZED");
        if (projection.dependencies.some(({ dependencyId, revision }) =>
          dependencyId === input.dependencyId && revision === input.dependencyRevision)) {
          return { replayed: true, event, projection };
        }
        const repaired = publishedProjection(projection, event);
        await this.persistence.saveProjection(repaired, projection.revision);
        return { replayed: true, event, projection: repaired };
      }
      const current = await this.persistence.readProjection(mvp02Scenario.scope);
      if (!current) throw new ApiError(500, "PROJECT_NOT_INITIALIZED");
      if (current.revision !== input.expectedRevision) throw new ApiError(409, "STALE_EXPECTED_REVISION");
      const next = publishedProjection(current, event);
      await this.persistence.appendEvent(event);
      await this.persistence.saveProjection(next, input.expectedRevision);
      return { replayed: false, event, projection: next };
    } catch (error) {
      return translatePersistenceError(error);
    }
  }
}
