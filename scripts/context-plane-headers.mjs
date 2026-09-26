#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(scriptDirectory, "../harness-hackathon/.env");
const envText = readFileSync(envPath, "utf8");
const line = envText
  .split(/\r?\n/u)
  .find((candidate) => candidate.startsWith("CONTEXT_PLANE_API_TOKEN="));

if (!line) {
  throw new Error(`CONTEXT_PLANE_API_TOKEN is missing from ${envPath}`);
}

let token = line.slice("CONTEXT_PLANE_API_TOKEN=".length).trim();
if (
  (token.startsWith('"') && token.endsWith('"')) ||
  (token.startsWith("'") && token.endsWith("'"))
) {
  token = token.slice(1, -1);
}

if (!token) {
  throw new Error(`CONTEXT_PLANE_API_TOKEN is empty in ${envPath}`);
}

process.stdout.write(
  JSON.stringify({ Authorization: `Bearer ${token}` }),
);
