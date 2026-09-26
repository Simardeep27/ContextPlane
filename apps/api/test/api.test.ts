import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CommandId, DependencyId, EventId, EvidenceId, RunId } from "@context-plane/contracts";
import { DurablePersistenceAdapter, MemoryStorage } from "@context-plane/persistence";
import { mvp02Scenario } from "@context-plane/scenario";

import { ContextApi, createContextApiHandler, type PublishDependencyInput } from "../src/index.js";

const projectPath = `/v1/projects/${mvp02Scenario.scope.projectId}`;

function publication(overrides: Partial<PublishDependencyInput> = {}): PublishDependencyInput {
  return {
    commandId: "command_dev_b_publish_8" as CommandId,
    idempotencyKey: "dev-b-publication-8",
    expectedRevision: 1,
    dependencyId: mvp02Scenario.dependency.dependencyId as DependencyId,
    dependencyRevision: mvp02Scenario.devBPublication.dependencyRevision,
    artifactHash: mvp02Scenario.devBPublication.artifact.artifactHash,
    evidenceId: mvp02Scenario.devBPublication.evidence.evidenceId as EvidenceId,
    publishedAt: "2026-09-26T15:00:00.000Z",
    ...overrides,
  };
}

async function fixture() {
  const persistence = new DurablePersistenceAdapter(new MemoryStorage());
  const api = new ContextApi(persistence);
  await api.initialize();
  return { persistence, handle: createContextApiHandler(api) };
}

function request(
  path: string,
  session: string | null,
  init: { method?: string; body?: unknown } = {},
): Request {
  return new Request(`http://context-plane.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(session ? { "x-demo-session": session } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

describe("MVP-03 Context API", () => {
  it("returns revision N before publication and N+1 afterward", async () => {
    const { handle } = await fixture();
    const before = await handle(request(`${projectPath}/context`, "dev-a"));
    assert.equal(before.status, 200);
    const beforeContext = await before.json();
    assert.equal(beforeContext.dependencyRevision, 7);
    assert.deepEqual(beforeContext.addressedMessages, []);

    const published = await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST",
      body: publication(),
    }));
    assert.equal(published.status, 201);

    const after = await handle(request(`${projectPath}/context`, "dev-a"));
    assert.equal(after.status, 200);
    const afterContext = await after.json();
    assert.equal(afterContext.dependencyRevision, 8);
    assert.equal(afterContext.policyEpoch, 1);
    assert.equal(afterContext.addressedMessages.length, 1);
    assert.deepEqual(afterContext.evidenceIds, [mvp02Scenario.devBPublication.evidence.evidenceId]);
    assert.ok(afterContext.allowedTools.includes("check_change"));
    assert.equal(JSON.stringify(afterContext).includes("contentHash"), false);
    assert.equal(JSON.stringify(afterContext).includes(mvp02Scenario.devBPublication.evidence.contentHash), false);
  });

  it("makes exact idempotency-key replays a no-op and rejects conflicting reuse", async () => {
    const { handle } = await fixture();
    const first = await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST",
      body: publication(),
    }));
    assert.equal(first.status, 201);
    assert.equal((await first.json()).replayed, false);

    const replay = await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST",
      body: publication(),
    }));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);

    const conflict = await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST",
      body: publication({ commandId: "command_conflicting_reuse" as CommandId }),
    }));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");

    const events = await handle(request(`${projectPath}/events`, "dev-a"));
    assert.equal(events.status, 200);
    assert.equal((await events.json()).events.length, 1);
    const projection = await handle(request(`${projectPath}/projection`, "dev-a"));
    assert.equal((await projection.json()).revision, 2);
  });

  it("rejects unauthenticated, cross-project, wrong-agent, and wrong-publisher access", async () => {
    const { handle } = await fixture();
    assert.equal((await handle(request(`${projectPath}/context`, null))).status, 401);
    assert.equal((await handle(request("/v1/projects/project_elsewhere/context", "dev-a"))).status, 403);
    const devBAgentId = mvp02Scenario.developers[1]?.agentId;
    assert.equal((await handle(request(`${projectPath}/context?agentId=${devBAgentId}`, "dev-a"))).status, 403);
    assert.equal((await handle(request(`${projectPath}/publications/dev-b`, "dev-a", {
      method: "POST",
      body: publication(),
    }))).status, 403);
  });

  it("rejects inherited object properties as session identities on every read route", async () => {
    const { handle } = await fixture();
    for (const session of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      for (const route of ["context", "projection", "events"]) {
        const response = await handle(request(`${projectPath}/${route}`, session));
        assert.equal(response.status, 401, `${session}: ${route}`);
        assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
      }
    }
  });

  it("publishes and reconciles idempotency beyond the first event page", async () => {
    const { persistence, handle } = await fixture();
    for (let cursor = 1; cursor <= 101; cursor++) {
      await persistence.appendEvent({
        eventId: `event_history_${cursor}` as EventId,
        type: "demo.history",
        scope: mvp02Scenario.scope,
        runId: "run_history" as RunId,
        actor: { kind: "system", id: "system", role: "system" },
        revision: cursor,
        cursor: String(cursor).padStart(6, "0"),
        occurredAt: "2026-09-26T14:00:00.000Z",
        payload: {},
      });
    }
    const first = await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST", body: publication(),
    }));
    assert.equal(first.status, 201);
    const published = await first.json();
    assert.equal(published.event.cursor, "000102");
    assert.equal(published.event.revision, 102);
    assert.equal(published.projection.revision, 2);

    const restarted = createContextApiHandler(new ContextApi(persistence));
    const replay = await restarted(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST", body: publication(),
    }));
    assert.equal(replay.status, 200);
    const replayed = await replay.json();
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.event, published.event);
    assert.deepEqual(replayed.projection, published.projection);

    const conflict = await restarted(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST", body: publication({ commandId: "command_conflicting_reuse" as CommandId }),
    }));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
    const remaining = await persistence.readEvents(mvp02Scenario.scope, "000100");
    assert.deepEqual(remaining.map(({ cursor }) => cursor), ["000101", "000102"]);
  });

  it("exposes the committed projection and cursor-resumable event timeline", async () => {
    const { handle } = await fixture();
    await handle(request(`${projectPath}/publications/dev-b`, "dev-b", {
      method: "POST",
      body: publication(),
    }));
    const projectionResponse = await handle(request(`${projectPath}/projection`, "dev-a"));
    const projection = await projectionResponse.json();
    assert.equal(projection.dependencies[0].artifactHash, mvp02Scenario.devBPublication.artifact.artifactHash);
    assert.deepEqual(projection.dependencies[0].evidenceIds, [mvp02Scenario.devBPublication.evidence.evidenceId]);
    const timeline = await handle(request(`${projectPath}/events?after=000000`, "dev-a"));
    const event = (await timeline.json()).events[0];
    assert.equal(event.type, "dependency.published");
    assert.deepEqual(event.payload.evidenceIds, [mvp02Scenario.devBPublication.evidence.evidenceId]);
    const exhausted = await handle(request(`${projectPath}/events?after=${event.cursor}`, "dev-a"));
    assert.deepEqual((await exhausted.json()).events, []);
  });
});
