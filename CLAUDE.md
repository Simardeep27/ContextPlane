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

Tests use the built-in `node:test` runner against compiled output, so always build first. Single test file / single test:

```sh
npm run build -w @context-plane/contracts
node --test packages/contracts/dist/contracts.test.js
node --test --test-name-pattern="cannot self-approve" packages/contracts/dist/contracts.test.js
```

## Architecture

Only `packages/contracts` exists; it freezes the boundary types for the planned components: Context API, worker, web app, persistence adapter, registered runner, and deterministic evaluator. New components should consume these types rather than redefine them.

Core model (`packages/contracts/src/contracts.ts`):
- **Event-sourced, project-scoped.** Every command/event carries `ProjectScope` (`orgId` + `projectId`). Commands carry `expectedRevision` + `idempotencyKey` (optimistic concurrency); events carry monotonic `revision` and a durable `cursor`. `ProjectProjection` (runs, access requests, timeline) is derived from events.
- **Durable runs.** An agent's work is a `Run` (`queued | running | blocked | completed | failed`) held under a `LeaseToken` with a `generation`; checkpoints and receipts are saved against the lease so a stale worker can't write.
- **Exactly-once side effects.** Each side effect has a stable `OperationKey` and an `OperationReceipt`; on resume, reconcile via `read_operation` / `RunnerAdapter.reconcile` instead of re-executing.
- **Access requests** are scoped (resource, action, purpose), expiring, and decided by a human owner — agents never approve.
- **Versioned changes.** Cross-service changes are pinned by `ChangeCheckVersion` (`candidateHash`, `dependencyRevision`, `policyEpoch`); stale candidates are rejected. `apply_change` publishes only the exact candidate that passed `run_checks`.
- **Learning loop.** `EvaluatorAdapter` scores a candidate rule on a hashed dataset (`unsafeCasesCaught` vs `validCasesBlocked`); promotion is human-only.

Adapters (`adapters.ts`): `PersistenceAdapter` (intended to be MongoDB), `ModelAdapter` (OpenRouter only), `RunnerAdapter`, `EvaluatorAdapter`.

Agent tools (`tools.ts`): 14 tools with strict JSON schemas (`additionalProperties: false`) and per-role allowlists for the synthetic demo roles `pm | orders | billing | notifications`. Tests enforce that no role gets an approve/promote tool — keep it that way when adding tools, and add every new tool to `toolNames`, `toolDefinitions`, and the relevant allowlists.

Fixtures (`src/fixtures/access-run.ts`): the canonical scenario — Orders run blocks on `demo.staging.orders:read`, PM approves, run resumes, completes with a receipted protected read. Synthetic data only; use it as the integration target for new components.

## Conventions

- Strict TS with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; ESM with `NodeNext` resolution, so relative imports use `.js` extensions.
- IDs are branded string types (`OrgId`, `RunId`, …); cast literals with `as` only in fixtures/tests.
- Secrets only in `.env` (gitignored); scripts read credentials from env vars.
