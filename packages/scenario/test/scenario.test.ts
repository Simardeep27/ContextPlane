import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { artifactHash, candidateHash, mvp02Scenario, seedMvp02Scenario } from "../src/index.js";

test("defines two synthetic developers, services, and one dependency edge", () => {
  assert.deepEqual(mvp02Scenario.developers.map(({ displayName }) => displayName), ["Dev A", "Dev B"]);
  assert.deepEqual(mvp02Scenario.services.map(({ serviceId }) => serviceId), ["orders", "billing"]);
  assert.equal(mvp02Scenario.dependency.providerServiceId, "orders");
  assert.equal(mvp02Scenario.dependency.consumerServiceId, "billing");
  assert.equal(mvp02Scenario.dependencyRevisions[0]?.revision, 7);
  assert.equal(mvp02Scenario.devBPublication.dependencyRevision, 8);
});

test("derives every artifact and candidate hash from canonical fixture content", () => {
  for (const artifacts of Object.values(mvp02Scenario.snapshots)) {
    for (const artifact of artifacts) {
      assert.equal(artifact.artifactHash, artifactHash(artifact.content));
    }
  }
  for (const candidate of [mvp02Scenario.staleCandidate, mvp02Scenario.combinedCandidate]) {
    assert.equal(candidate.candidateHash, candidateHash({
      dependencyRevision: candidate.dependencyRevision,
      policyEpoch: candidate.policyEpoch,
      changeKind: candidate.changeKind,
      artifacts: candidate.artifacts.map(({ path, artifactHash: hash }) => ({ path, artifactHash: hash })),
    }));
  }
  assert.equal(mvp02Scenario.staleCandidate.dependencyRevision, 7);
  assert.equal(mvp02Scenario.staleCandidate.expectedOutcome, "consumer-contract-failure");
  assert.equal(mvp02Scenario.combinedCandidate.dependencyRevision, 8);
  assert.equal(mvp02Scenario.combinedCandidate.expectedOutcome, "pass");
  assert.notEqual(mvp02Scenario.staleCandidate.candidateHash, mvp02Scenario.combinedCandidate.candidateHash);
  assert.equal(
    mvp02Scenario.devBPublication.artifact.artifactHash,
    "sha256:1805886bd9eac939cb52a57892ec43cd0713d05bb6001ebead03502891ea97a3",
  );
  assert.equal(
    mvp02Scenario.staleCandidate.candidateHash,
    "sha256:6552b2240ce394fe4b0f8f81278392617fdc65e2f6914a2f12ddf3f64060fc39",
  );
  assert.equal(
    mvp02Scenario.combinedCandidate.candidateHash,
    "sha256:6bfefc738caabc24e0b1b0028fb8a24f1e084d6e72e5f245b9f60ba19daa28ea",
  );
});

test("freezes unsafe, valid, safe, and unrelated policy outcomes", () => {
  assert.equal(
    mvp02Scenario.policyDatasetHash,
    "sha256:af92a3ca2d5c3cfce95db86094c3d8ce8e85a511047532176a0916aecc1111e1",
  );
  assert.ok(mvp02Scenario.policyCases.filter(({ expectedDecision }) => expectedDecision === "block").length >= 2);
  assert.ok(mvp02Scenario.policyCases.some(({ caseId, expectedDecision }) =>
    caseId === "valid-coordinated-unit-change" && expectedDecision === "allow"));
  assert.ok(mvp02Scenario.policyCases.some(({ changeKind, expectedDecision }) =>
    changeKind === "field_addition" && expectedDecision === "allow"));
  assert.ok(mvp02Scenario.policyCases.some(({ observedFailure, eligibleForLearning, expectedDecision }) =>
    observedFailure === "unrelated-test" && !eligibleForLearning && expectedDecision === "ignore"));
});

test("reset and seed is deterministic and removes prior generated changes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "context-plane-mvp-02-"));
  const output = join(parent, "seed");
  const first = await seedMvp02Scenario(output);
  await writeFile(join(output, "snapshots/baseline/services/orders/src/quote.ts"), "changed", "utf8");
  const second = await seedMvp02Scenario(output);
  assert.equal(second.outputHash, first.outputHash);
  assert.equal(second.outputHash, "sha256:092a27f7975cf3c822d8e8f5e772ee18516629b7baa767fdb6f0d3cf98a3071f");
  assert.equal(second.fileCount, first.fileCount);
  assert.equal(
    await readFile(join(output, "snapshots/baseline/services/orders/src/quote.ts"), "utf8"),
    mvp02Scenario.snapshots.baseline[0]?.content,
  );
  const manifest = await readFile(join(output, "manifest.json"), "utf8");
  assert.doesNotMatch(manifest, /password|api[_-]?key|access[_-]?token|private[_-]?key/iu);
});

test("refuses to reset a directory that was not created by the seeder", async () => {
  const output = await mkdtemp(join(tmpdir(), "context-plane-unmarked-"));
  await assert.rejects(seedMvp02Scenario(output), /Refusing to reset unmarked directory/u);
});
