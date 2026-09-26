#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { displaySeedResult, seedMvp02Scenario } from "./seed-scenario.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const outputArgument = process.argv[2];
const outputDirectory = outputArgument
  ? resolve(process.cwd(), outputArgument)
  : resolve(repositoryRoot, "demo/generated/mvp-02");

const result = await seedMvp02Scenario(outputDirectory);
process.stdout.write(`${displaySeedResult(result, repositoryRoot)}\n`);
