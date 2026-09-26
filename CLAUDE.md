# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

Context Plane connects the AI agents of people across a company so work moves between teams with shared context: a PM's agent gets evidence-backed status (completed work, forecasts, blockers) from developers' agents; a developer's agent sends a scoped dependency/access request to the authorized owner, and once a human approves, Context Plane coordinates provisioning, confirms the blocker is resolved, and updates progress. Handoffs persist across long-running projects, and the system learns tested improvements from failed coordination.

Built for The Harness Engineering & Model Wrangling Hackathon (Sept 26, 2026). Hard constraints: use the **MongoDB Atlas Hackathon Sandbox** (no separate Atlas project), all work original, final repo public, submission via Cerebral Valley (public repo + 1-minute demo video + short description). `CODEX_HACKATHON_INFRA_BOOTSTRAP.md` is the service-setup runbook (it assumes Python; the codebase is TypeScript — follow its service/secret rules, not its language choice).

## Commands

Node >= 22, npm workspaces (`packages/*`). From the repo root:

```sh
npm ci
npm run build       # tsc for every workspace
npm test            # builds, then node --test on dist/**/*.test.js
npm run typecheck
```

Workspaces resolve `@context-plane/contracts` (and persistence) from `dist/`, so rebuild a package before typechecking/testing its dependents. Contracts tests run from compiled output; persistence and scenario tests run TypeScript via `node --import tsx --test`. Single test file / single test:

```sh
node --test --test-name-pattern="cannot self-approve" packages/contracts/dist/contracts.test.js
node --import tsx --test --test-name-pattern="authorizes only" packages/persistence/test/memory.test.ts
```

MongoDB Atlas (sandbox cluster; `MONGODB_URI` in the root `.env`):

```sh
npm run scenario:seed   # reset + seed the Dev A/Dev B scenario into context_plane_poc
CONTEXT_PLANE_ATLAS_TESTS=1 node --env-file=.env --import tsx --test packages/persistence/test/atlas.test.ts
```

The live suite creates and removes a `cp_persistence_test_<uuid>` database. Atlas's `readWriteAnyDatabase` cannot `dropDatabase`, so cleanup drops collections instead.

Work is tracked as the MVP-01..09 backlog in `docs/issues/` (GitHub issues #11–#19).

## Architecture

Packages: `contracts` (shared boundary types for the planned API, worker, runner, evaluator, and UI), `persistence` (`DurablePersistenceAdapter` over MongoDB or an in-memory fixture), and `scenario` (deterministic Dev A/Dev B fixture + seed). New components consume contract types and inject the adapter; never import persistence internals or expose raw `Storage` to agents.

Core model (`packages/contracts/src/contracts.ts`):
- **Event-sourced, project-scoped.** Every command/event carries `ProjectScope` (`orgId` + `projectId`). Commands carry `expectedRevision` + `idempotencyKey` (optimistic concurrency); events carry monotonic `revision` and a durable `cursor`. `ProjectProjection` (runs, access requests, timeline) is derived from events.
- **Durable runs.** An agent's work is a `Run` (`queued | running | blocked | completed | failed`) held under a `LeaseToken` with a `generation`; checkpoints and receipts are saved against the lease so a stale worker can't write.
- **Exactly-once side effects.** Each side effect has a stable `OperationKey` and an `OperationReceipt`; on resume, reconcile via `read_operation` / `RunnerAdapter.reconcile` instead of re-executing.
- **Access requests** are scoped (resource, action, purpose), expiring, and decided by a human owner — agents never approve.
- **Versioned changes.** Cross-service changes are pinned by `ChangeCheckVersion` (`candidateHash`, `dependencyRevision`, `policyEpoch`); stale candidates are rejected. `apply_change` publishes only the exact candidate that passed `run_checks`.
- **Learning loop.** `EvaluatorAdapter` scores a candidate rule on a hashed dataset (`unsafeCasesCaught` vs `validCasesBlocked`); promotion is human-only.

Adapters (`adapters.ts`): `PersistenceAdapter`, `ModelAdapter` (OpenRouter only), `RunnerAdapter`, `EvaluatorAdapter`. `LeaseToken` carries its `scope`; always pass back the whole token.

Domain records (`records.ts`): dependency revisions, candidates, check results, publication authorizations, policy candidates, and policy versions, written via `saveRecord` (trusted API/seed) or inside `commitStep` (worker). Persistence enforces storage invariants only (scope, per-record CAS revision, immutability of evidence records, dependency head +1, authorization only for passing checks at the current head/epoch); workflow decisions belong to core. `staleVersionReasons()` gives machine-readable reason codes for version tuples.

Persistence (`packages/persistence`): every mutation in a project runs in one MongoDB transaction that bumps a per-project guard document, serializing writes and providing the server clock. Collections `cp_projects`, `cp_runs`, `cp_events`, `cp_receipts`, `cp_records`, keyed by `JSON.stringify([orgId, projectId, key])`. Errors are sanitized to `INVALID_INPUT | CONFLICT | LEASE_LOST | IDEMPOTENCY_CONFLICT | STORAGE_UNAVAILABLE`. See its README for the worker commit sequence.

Agent tools (`tools.ts`): 14 tools with strict JSON schemas (`additionalProperties: false`) and per-role allowlists for the synthetic demo roles `pm | orders | billing | notifications`. Tests enforce that no role gets an approve/promote tool — keep it that way when adding tools, and add every new tool to `toolNames`, `toolDefinitions`, and the relevant allowlists.

Fixtures: `contracts/src/fixtures/access-run.ts` (Orders run blocks on access, PM approves, run completes) and `scenario/src/fixture.ts` (the minimum-demo flow: Orders contract revision 7 → 8, Dev A's stale Billing candidate, the combined candidate, Dev B's publication command, and the frozen policy dataset). Scenario hashes are pinned in its tests. Synthetic data only.

## Conventions

- Strict TS with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; ESM with `NodeNext` resolution, so relative imports use `.js` extensions.
- IDs are branded string types (`OrgId`, `RunId`, …); cast literals with `as` only in fixtures/tests.
- Secrets only in `.env` (gitignored); scripts read credentials from env vars.
