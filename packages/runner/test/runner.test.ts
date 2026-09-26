import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mvp02Scenario, type ScenarioSnapshotId } from "@context-plane/scenario";
import { ScenarioRunner, snapshotCandidateHash } from "../src/index.js";

async function runner() { return new ScenarioRunner(await mkdtemp(join(tmpdir(), "context-plane-runner-"))); }

test("actual baseline, changed failure, revert and coordinated artifacts execute", async () => {
  const subject = await runner();
  const baseline = await subject.check("dev-b-published", "baseline");
  const changed = await subject.check("stale-candidate", "changed");
  const reverted = await subject.check("dev-b-published", "reverted");
  const coordinated = await subject.check("combined-candidate", "coordinated");
  assert.equal((await subject.check("baseline", "original")).passed, true);
  assert.equal(baseline.passed, true);
  assert.equal(changed.passed, false);
  assert.equal(changed.exitCode, 1);
  assert.match(changed.output, /Orders\/Billing monetary contract/);
  assert.match(changed.output, /NaN/);
  assert.equal(changed.candidateHash, mvp02Scenario.staleCandidate.candidateHash);
  assert.deepEqual(baseline.artifacts, reverted.artifacts);
  assert.equal(changed.artifacts[1]?.artifactHash, baseline.artifacts[1]?.artifactHash);
  assert.equal(reverted.passed, true);
  assert.equal(coordinated.passed, true);
  assert.equal(coordinated.candidateHash, mvp02Scenario.combinedCandidate.candidateHash);
  await assert.rejects(subject.publish("stale-candidate", "changed", changed.candidateHash), /successful check/);
});

test("restart reconciles atomic publication before any external DB receipt exists", async () => {
  const subject = await runner();
  const checked = await subject.check("combined-candidate", "publish-once");
  assert.equal(await subject.reconcile("publish-once"), null);
  const published = await subject.publish("combined-candidate", "publish-once", checked.candidateHash);
  // Worker state is discarded here; only the caller-owned filesystem survives.
  const restarted = new ScenarioRunner(subject.rootDir);
  assert.deepEqual(await restarted.reconcile("publish-once"), published);
  assert.deepEqual(await restarted.publish("combined-candidate", "publish-once", checked.candidateHash), published);
  assert.deepEqual(await readdir(join(subject.rootDir, "publications")), ["publish-once"]);
  assert.equal(await readFile(join(published.publicationPath!, "services/orders/src/quote.ts"), "utf8"), mvp02Scenario.snapshots["combined-candidate"][0].content);
});

test("changed bytes, harness and expected candidate hashes invalidate publication", async () => {
  const subject = await runner();
  const checked = await subject.check("combined-candidate", "tampered");
  const staged = await subject.stage("combined-candidate", "tampered");
  await writeFile(join(staged.directory, "services/orders/src/quote.ts"), "throw new Error('changed');");
  await assert.rejects(subject.publish("combined-candidate", "tampered", checked.candidateHash), /artifact hash mismatch/);
  assert.equal(await subject.reconcile("tampered"), null);
  await assert.rejects(subject.publish("combined-candidate", "new-hash", "sha256:bad"), /candidate hash mismatch/);
  const command = await subject.stage("combined-candidate", "command");
  await writeFile(join(command.directory, "check.mjs"), "console.log(process.env);");
  await assert.rejects(subject.check("combined-candidate", "command"), /executor changed/);
});

test("unknown snapshots, unsafe keys, key reuse, and symlink artifacts are rejected", async () => {
  const subject = await runner();
  await assert.rejects(subject.check("shell" as ScenarioSnapshotId, "unknown"), /Unknown registered snapshot/);
  for (const key of ["", "../outside", "/tmp/escape", "bad/key", "x".repeat(129)]) await assert.rejects(subject.check("baseline", key), /operation key/);
  await subject.stage("baseline", "reused");
  await assert.rejects(subject.stage("combined-candidate", "reused"), /key reused/);
  const linkRunner = await runner();
  await symlink(subject.rootDir, join(linkRunner.rootDir, "operations"));
  await assert.rejects(linkRunner.stage("baseline", "symlink"), /real directory/);
  assert.equal(await subject.reconcile("symlink"), null);
});

test("publication receipt and published bytes are validated during reconciliation", async () => {
  const subject = await runner();
  const checked = await subject.check("baseline", "receipt");
  const published = await subject.publish("baseline", "receipt", snapshotCandidateHash("baseline"));
  const receiptPath = join(published.publicationPath!, "receipt.json");
  const original = await readFile(receiptPath, "utf8");
  await writeFile(receiptPath, original.replace(checked.candidateHash, "sha256:changed"));
  await assert.rejects(subject.reconcile("receipt"), /Invalid execution receipt/);
  await writeFile(receiptPath, original);
  await writeFile(join(published.publicationPath!, "services/billing/src/invoice.ts"), "tampered");
  await assert.rejects(subject.reconcile("receipt"), /artifact hash mismatch/);
});

test("child execution does not inherit parent Node flags", async () => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--context-plane-invalid-parent-option";
  try {
    const subject = await runner();
    assert.equal((await subject.check("baseline", "clean-environment")).passed, true);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test("killed worker after effect leaves one reconcilable publication", async () => {
  const subject = await runner();
  const worker = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./crash-worker.ts", import.meta.url)), subject.rootDir], {
    env: { PATH: dirname(process.execPath) }, timeout: 15_000, maxBuffer: 8192, encoding: "utf8",
  });
  assert.equal(worker.error, undefined);
  assert.equal(worker.signal, "SIGKILL", worker.stderr);
  const restarted = new ScenarioRunner(subject.rootDir);
  const recovered = await restarted.reconcile("crash-after-effect");
  assert.equal(recovered?.published, true);
  assert.deepEqual(await restarted.publish("combined-candidate", "crash-after-effect", snapshotCandidateHash("combined-candidate")), recovered);
  assert.deepEqual(await readdir(join(subject.rootDir, "publications")), ["crash-after-effect"]);
});
