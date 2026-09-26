import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalJson, sha256 } from "./hash.js";
import { mvp02Scenario } from "./scenario.js";

const markerName = ".context-plane-mvp-02-seed";
const markerValue = "context-plane:mvp-02:v1\n";

export interface SeedResult {
  readonly outputDirectory: string;
  readonly fileCount: number;
  readonly outputHash: string;
  readonly staleCandidateHash: string;
  readonly combinedCandidateHash: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function serializedManifest(): string {
  return `${JSON.stringify(mvp02Scenario, null, 2)}\n`;
}

function serializedPolicyCases(): string {
  return `${JSON.stringify({
    datasetHash: mvp02Scenario.policyDatasetHash,
    cases: mvp02Scenario.policyCases,
  }, null, 2)}\n`;
}

function generatedFiles(): ReadonlyMap<string, string> {
  const files = new Map<string, string>([
    [markerName, markerValue],
    ["manifest.json", serializedManifest()],
    ["cases/policy-evaluation.json", serializedPolicyCases()],
  ]);
  for (const [snapshotId, artifacts] of Object.entries(mvp02Scenario.snapshots)) {
    for (const artifact of artifacts) {
      files.set(`snapshots/${snapshotId}/${artifact.path}`, artifact.content);
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function assertSafeResetTarget(outputDirectory: string): Promise<void> {
  const markerPath = join(outputDirectory, markerName);
  if (!(await exists(outputDirectory))) return;
  if (!(await exists(markerPath)) || await readFile(markerPath, "utf8") !== markerValue) {
    throw new Error(`Refusing to reset unmarked directory: ${outputDirectory}`);
  }
}

export async function seedMvp02Scenario(outputPath: string): Promise<SeedResult> {
  const outputDirectory = resolve(outputPath);
  if (outputDirectory === resolve(outputDirectory, "..")) {
    throw new Error("Refusing to seed a filesystem root");
  }
  await assertSafeResetTarget(outputDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  const files = generatedFiles();
  for (const [path, content] of files) {
    const destination = join(outputDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  const outputHash = sha256(canonicalJson([...files].map(([path, content]) => ({ path, content }))));
  return {
    outputDirectory,
    fileCount: files.size,
    outputHash,
    staleCandidateHash: mvp02Scenario.staleCandidate.candidateHash,
    combinedCandidateHash: mvp02Scenario.combinedCandidate.candidateHash,
  };
}

export function displaySeedResult(result: SeedResult, repositoryRoot: string): string {
  return JSON.stringify({
    ...result,
    outputDirectory: relative(repositoryRoot, result.outputDirectory),
  });
}
