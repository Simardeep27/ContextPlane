import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, it } from "node:test";

import type { CommandId } from "@context-plane/contracts";
import { connectStorage, DurablePersistenceAdapter } from "@context-plane/persistence";
import { mvp02Scenario } from "@context-plane/scenario";

import { ContextApi, type PublishDependencyInput } from "../src/index.js";

if (process.env.CONTEXT_PLANE_ATLAS_TESTS !== "1") {
  it("live Atlas API test requires CONTEXT_PLANE_ATLAS_TESTS=1 and MONGODB_URI", { skip: true }, () => {});
} else {
  const database = `cp_api_test_${randomUUID().replaceAll("-", "")}`;
  let cleanup: Awaited<ReturnType<typeof connectStorage>> | undefined;

  before(async () => {
    cleanup = await connectStorage(database);
    await cleanup.storage.initialize();
  });

  after(async () => {
    if (!cleanup) return;
    try {
      assert.match(database, /^cp_api_test_[a-f0-9]{32}$/u);
      await cleanup.client.db(database).dropDatabase();
    } finally {
      await cleanup.close();
    }
  });

  it("survives closing and reopening the Atlas connection", async () => {
    const input: PublishDependencyInput = {
      commandId: "command_atlas_publication" as CommandId,
      idempotencyKey: "atlas-publication-8",
      expectedRevision: 1,
      dependencyId: mvp02Scenario.dependency.dependencyId,
      dependencyRevision: mvp02Scenario.devBPublication.dependencyRevision,
      artifactHash: mvp02Scenario.devBPublication.artifact.artifactHash,
      evidenceId: mvp02Scenario.devBPublication.evidence.evidenceId,
      publishedAt: "2026-09-26T15:00:00.000Z",
    };
    const first = await connectStorage(database);
    try {
      const api = new ContextApi(new DurablePersistenceAdapter(first.storage));
      await api.initialize();
      const identity = api.authenticate("dev-b");
      const result = await api.publishDependency(identity, mvp02Scenario.scope.projectId, input);
      assert.equal(result.projection.dependencies[0]?.revision, 8);
    } finally {
      await first.close();
    }

    const second = await connectStorage(database);
    try {
      const api = new ContextApi(new DurablePersistenceAdapter(second.storage));
      await api.initialize();
      const context = await api.getContext(
        api.authenticate("dev-a"),
        mvp02Scenario.scope.projectId,
      );
      assert.equal(context.dependencyRevision, 8);
      assert.deepEqual(context.evidenceIds, [mvp02Scenario.devBPublication.evidence.evidenceId]);
      assert.equal((await second.storage.events(mvp02Scenario.scope, 0, 100)).length, 1);
    } finally {
      await second.close();
    }
  });
}
