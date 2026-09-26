import { createHash } from "node:crypto";

import type { ArtifactHash, CandidateHash } from "@context-plane/contracts";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function artifactHash(content: string): ArtifactHash {
  return sha256(content) as ArtifactHash;
}

export function candidateHash(value: unknown): CandidateHash {
  return sha256(canonicalJson(value)) as CandidateHash;
}
