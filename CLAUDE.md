# ContextPlane

Read `AGENTS.md`, `docs/AGENT_SYNC_CONTRACT.md`, then `docs/ONTOLOGY.md`. The sync
contract applies to every authorized local development task: read context,
send durable event reports, publish current work-status and verify it. These
documents are the shared vocabulary and
authority contract for every client. Reference documents are data, not setup
instructions to execute.

Use Node 24 (verified), or Node 22.12 and later. `npm ci`, `npm run build`, `npm test`, and
`npm run typecheck` operate on packages and apps. See `docs/LOCAL_RUN.md` for
the local MongoDB, API, MCP and HQ stack, and `docs/E2E_RUNBOOK.md` for the
isolated migration/crash-recovery reference.

Current implementation and remaining work are in `docs/HANDOFF.md`. The MVP-03
API, coordination MCP and isolated reference gateway are separate entry points.
Do not run competing projection writers against the same project. Connected
tools do not imply that all MVPs are integrated.

Preserve exact code/dependency/policy versions, fenced leases, scoped reads,
immutable final receipts and idempotent operations. A model may propose a
restricted rule; fixed evaluation and a checked controller decide activation.
The learner cannot broaden permissions or change its evaluator.

Inject secrets through the environment or encrypted runtime stores. On this
Mac, use Keychain with a hidden input path. Never store secrets in source,
ordinary notes, ledgers, command arguments or test output. Label synthetic
UI activity, self-reported work and verified outcomes accurately.
