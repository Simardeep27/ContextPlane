import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { ArtifactHash, CandidateHash, EvidenceId, OperationKey } from "@context-plane/contracts";
import { artifactHash, candidateHash, canonicalJson, mvp02Scenario, sha256, type ScenarioSnapshotId } from "@context-plane/scenario";

export interface ExecutionProof {
  readonly operationKey: OperationKey;
  readonly candidateHash: CandidateHash;
  readonly snapshotId: ScenarioSnapshotId;
  readonly passed: boolean;
  readonly evidenceIds: readonly EvidenceId[];
  readonly resultHash: string;
  readonly exitCode: number | null;
  readonly output: string;
  readonly artifacts: readonly { readonly path: string; readonly artifactHash: ArtifactHash }[];
  readonly registeredChecks: readonly [typeof REGISTERED_CHECK];
  readonly published?: true;
  readonly publicationPath?: string;
}

export const REGISTERED_CHECK = "consumer-integration";

const TEST = `import assert from 'node:assert/strict';
import { quoteTotal } from './services/orders/src/quote.ts';
import { invoiceTotalDollars } from './services/billing/src/invoice.ts';
for (const [price, quantity, expected] of [[1234,3,37.02],[199,2,3.98],[0,9,0],[250,0,0]]) {
  const actual = invoiceTotalDollars(quoteTotal(price, quantity));
  assert.equal(actual, expected, 'Orders/Billing monetary contract: ' + price + ' x ' + quantity);
}
console.log('PASS: 4 real Orders/Billing monetary contract cases');
`;
const PACKAGE = '{"type":"module"}\n';
const MAX_OUTPUT = 8192;
const TIMEOUT_MS = 5000;
const ARTIFACT_PATHS = ["services/orders/src/quote.ts", "services/billing/src/invoice.ts"];

function snapshot(id: ScenarioSnapshotId) {
  if (!Object.hasOwn(mvp02Scenario.snapshots, id)) throw new Error("Unknown registered snapshot");
  return mvp02Scenario.snapshots[id];
}
function key(value: string): OperationKey {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) throw new Error("Invalid operation key");
  return value as OperationKey;
}
export function snapshotCandidateHash(id: ScenarioSnapshotId): CandidateHash {
  const artifacts = snapshot(id);
  if (id === "stale-candidate") return mvp02Scenario.staleCandidate.candidateHash;
  if (id === "combined-candidate") return mvp02Scenario.combinedCandidate.candidateHash;
  return candidateHash({ snapshotId: id, artifacts: artifacts.map(({ path, artifactHash }) => ({ path, artifactHash })) });
}
function proof(input: Omit<ExecutionProof, "resultHash">): ExecutionProof {
  return { ...input, resultHash: sha256(canonicalJson(input)) };
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function regularText(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Invalid runner file");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

/** Fixed synthetic executor. Bounded child process; NOT an OS/network sandbox. */
export class ScenarioRunner {
  readonly rootDir: string;
  constructor(rootDir: string) {
    if (!isAbsolute(rootDir) || resolve(rootDir) === parse(resolve(rootDir)).root) throw new Error("Runner needs an absolute caller-owned directory");
    this.rootDir = resolve(rootDir);
  }
  private async directory(path: string): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    // Inspect every component inside the caller's root; never follow staged symlinks.
    let current = this.rootDir;
    for (const part of ["", ...path.slice(this.rootDir.length + 1).split("/").filter(Boolean)]) {
      if (part) {
        current = join(current, part);
        try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Runner directory is not a real directory");
    }
  }
  private metadata(id: ScenarioSnapshotId, operationKey: OperationKey) {
    return { operationKey, snapshotId: id, candidateHash: snapshotCandidateHash(id), testHash: sha256(TEST) };
  }
  private async validate(directory: string, id: ScenarioSnapshotId, operationKey: OperationKey): Promise<void> {
    await this.directory(directory);
    if (await regularText(join(directory, "candidate.json")) !== canonicalJson(this.metadata(id, operationKey))) throw new Error("Operation key reused or candidate metadata changed");
    for (const artifact of snapshot(id)) {
      if (!ARTIFACT_PATHS.includes(artifact.path) || artifactHash(artifact.content) !== artifact.artifactHash) throw new Error("Unregistered artifact");
      await this.directory(dirname(join(directory, artifact.path)));
      if (artifactHash(await regularText(join(directory, artifact.path))) !== artifact.artifactHash) throw new Error("Staged artifact hash mismatch");
    }
    if (await regularText(join(directory, "check.mjs")) !== TEST || await regularText(join(directory, "package.json")) !== PACKAGE) throw new Error("Registered executor changed");
    const allowed = new Set([...ARTIFACT_PATHS, "candidate.json", "check.mjs", "package.json", "check.json", "receipt.json"]);
    const inspect = async (dir: string, prefix = ""): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (entry.isDirectory() && ARTIFACT_PATHS.some((path) => path.startsWith(relative + "/"))) await inspect(join(dir, entry.name), relative + "/");
        else if (!entry.isFile() || !allowed.has(relative)) throw new Error("Unexpected runner artifact");
      }
    };
    await inspect(directory);
  }
  async stage(id: ScenarioSnapshotId, operationKey: OperationKey | string): Promise<{ candidateHash: CandidateHash; directory: string }> {
    snapshot(id); const operation = key(operationKey);
    const directory = join(this.rootDir, "operations", operation);
    await this.directory(join(this.rootDir, "operations"));
    if (!await exists(directory)) {
      await this.directory(join(this.rootDir, "pending"));
      const temporary = await mkdtemp(join(this.rootDir, "pending", "stage-"));
      for (const artifact of snapshot(id)) {
        if (!ARTIFACT_PATHS.includes(artifact.path) || artifactHash(artifact.content) !== artifact.artifactHash) throw new Error("Unregistered artifact");
        await this.directory(dirname(join(temporary, artifact.path)));
        await writeFile(join(temporary, artifact.path), artifact.content, { flag: "wx", mode: 0o600 });
      }
      for (const [name, content] of [["candidate.json", canonicalJson(this.metadata(id, operation))], ["check.mjs", TEST], ["package.json", PACKAGE]] as const) await writeFile(join(temporary, name), content, { flag: "wx", mode: 0o600 });
      try { await rename(temporary, directory); } catch (error) { if (!await exists(directory)) throw error; }
    }
    await this.validate(directory, id, operation);
    return { candidateHash: snapshotCandidateHash(id), directory };
  }
  private execute(directory: string): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "check.mjs"], {
        cwd: directory, env: { PATH: dirname(process.execPath), HOME: directory, TMPDIR: directory }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = ""; let bounded = false;
      const timer = setTimeout(() => { bounded = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
      const collect = (data: Buffer) => {
        output += data.toString("utf8");
        if (Buffer.byteLength(output) > MAX_OUTPUT) { output = Buffer.from(output).subarray(0, MAX_OUTPUT).toString("utf8"); bounded = true; child.kill("SIGKILL"); }
      };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolveResult({ exitCode: bounded ? null : code, output }); });
    });
  }
  async check(id: ScenarioSnapshotId, operationKey: OperationKey | string): Promise<ExecutionProof> {
    const operation = key(operationKey);
    const staged = await this.stage(id, operation);
    const result = await this.execute(staged.directory);
    await this.validate(staged.directory, id, operation);
    const evidenceId = `evidence_runner_${sha256(canonicalJson({ operation, candidateHash: staged.candidateHash, ...result })).slice(7, 31)}` as EvidenceId;
    const checked = proof({ operationKey: operation, snapshotId: id, candidateHash: staged.candidateHash, passed: result.exitCode === 0, evidenceIds: [evidenceId], artifacts: snapshot(id).map(({path, artifactHash}) => ({path, artifactHash})), registeredChecks: [REGISTERED_CHECK], ...result });
    await writeFile(join(staged.directory, "check.json"), canonicalJson(checked), { mode: 0o600 });
    return checked;
  }
  private async receipt(path: string): Promise<ExecutionProof> {
    const parsed = JSON.parse(await regularText(path)) as ExecutionProof;
    const { resultHash, ...input } = parsed;
    if (resultHash !== proof(input).resultHash || !Array.isArray(parsed.evidenceIds) || typeof parsed.output !== "string") throw new Error("Invalid execution receipt");
    if (canonicalJson(parsed.registeredChecks) !== canonicalJson([REGISTERED_CHECK]) || canonicalJson(parsed.artifacts) !== canonicalJson(snapshot(parsed.snapshotId).map(({ path, artifactHash }) => ({ path, artifactHash })))) throw new Error("Receipt does not bind registered artifacts/checks");
    return parsed;
  }
  async publish(id: ScenarioSnapshotId, operationKey: OperationKey | string, expectedCandidateHash: CandidateHash | string): Promise<ExecutionProof> {
    const operation = key(operationKey);
    if (snapshotCandidateHash(id) !== expectedCandidateHash) throw new Error("Expected candidate hash mismatch");
    const staged = await this.stage(id, operation);
    const prior = await this.reconcile(operation);
    if (prior) { if (prior.candidateHash !== expectedCandidateHash || prior.snapshotId !== id) throw new Error("Publication key reused"); return prior; }
    const checked = await this.receipt(join(staged.directory, "check.json"));
    if (!checked.passed || checked.exitCode !== 0 || checked.operationKey !== operation || checked.snapshotId !== id || checked.candidateHash !== expectedCandidateHash || checked.published) throw new Error("Publication requires matching successful check");
    const publicationPath = join(this.rootDir, "publications", operation);
    await this.directory(dirname(publicationPath));
    const temporary = await mkdtemp(join(this.rootDir, "pending", "publish-"));
    // Read and verify the exact bytes copied, not just an earlier path check.
    for (const artifact of snapshot(id)) {
      const content = await regularText(join(staged.directory, artifact.path));
      if (artifactHash(content) !== artifact.artifactHash) throw new Error("Staged artifact hash mismatch");
      await this.directory(dirname(join(temporary, artifact.path)));
      await writeFile(join(temporary, artifact.path), content, { flag: "wx", mode: 0o600 });
    }
    const { resultHash: _, ...checkedInput } = checked;
    const published = proof({ ...checkedInput, published: true, publicationPath });
    for (const name of ["candidate.json", "check.mjs", "package.json"]) await writeFile(join(temporary, name), await regularText(join(staged.directory, name)), { flag: "wx", mode: 0o600 });
    await writeFile(join(temporary, "receipt.json"), canonicalJson(published), { flag: "wx", mode: 0o600 });
    await this.validate(temporary, id, operation);
    await this.validate(staged.directory, id, operation);
    // This atomic directory move IS the synthetic effect; its receipt moves with it.
    try { await rename(temporary, publicationPath); } catch (error) { if (!await exists(publicationPath)) throw error; }
    return (await this.reconcile(operation))!;
  }
  async reconcile(operationKey: OperationKey | string): Promise<ExecutionProof | null> {
    const operation = key(operationKey);
    const directory = join(this.rootDir, "publications", operation);
    if (!await exists(directory)) return null;
    await this.directory(directory);
    const result = await this.receipt(join(directory, "receipt.json"));
    if (result.operationKey !== operation || result.published !== true || !result.passed || result.exitCode !== 0 || result.publicationPath !== directory || snapshotCandidateHash(result.snapshotId) !== result.candidateHash) throw new Error("Invalid publication receipt");
    await this.validate(directory, result.snapshotId, operation);
    return result;
  }
}
