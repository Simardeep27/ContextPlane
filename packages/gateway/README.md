# Deterministic reference gateway

This package joins the shared persistence adapter, pure core decisions, and
registered scenario runner. It is an isolated reference implementation for the
end-to-end baseline, not a replacement for the team's active server.

There are no model calls. Proposals, diagnostics, rule derivation and checks are
explicit deterministic operations over registered synthetic source files.

## API

`createHarness({ persistence, runner, scope, runId, credentials, controllerToken,
crashAfterEffect?, now? })` returns:

- `execute({ token, tool, operationKey, args, scope? })`
- `context(token)`
- `diagnoseFailure(controllerToken, operationKey)`
- `learnFromFailure(controllerToken, operationKey)`
- `controllerState(controllerToken)`

Credentials are trusted server configuration, not request fields. Each maps a
token to `personId`, `agentId`, `role`, and `sessionId`, optionally with an explicit
tool allowlist. Two sessions can belong to the same logical agent. Their shared
operation key deliberately reconciles the same operation on reconnect; a changed
request or acting person/agent cannot reuse that key. Never put real tokens in
checked-in configuration or command arguments.

The supplied scenario has Dev A (`agent_dev_a_orders`) and Dev B
(`agent_dev_b_billing`). The host must explicitly allow Dev B's `apply_change` for
its registered Billing publication; the default billing role does not include
publication. Snapshot ownership is checked independently of the tool allowlist.

`createGatewayServer(harness)` returns a Node HTTP server. The caller starts it
on loopback. This is **authenticated JSON HTTP, not MCP**:

| Route | Authorization | Input |
| --- | --- | --- |
| `GET /context` | Personal-agent bearer token | None |
| `POST /commands` | Personal-agent bearer token | `{tool, operationKey, args, scope?}` |
| `GET /controller/state` | Controller bearer token | None |
| `POST /controller/diagnose` | Controller bearer token | `{operationKey}` |
| `POST /controller/learn` | Controller bearer token | `{operationKey}` |

Only implemented tools are accepted: context/operation reads, progress reports,
addressed messages, propose/check/acknowledge/stage/checks/apply. Access-broker,
arbitrary shell, direct database and policy-promotion tools are unavailable.
Shared tool schemas reject extra properties and prototype-bearing inputs.

## Domain sequence

1. Dev B proposes `snapshotCandidateHash('dev-b-published')` against dependency 7.
   Stage its complete snapshot artifact hashes, run `['consumer-integration']`,
   then apply. Successful publication advances the dependency to 8.
2. Dev A's `stale-candidate` retains declared dependency 7 and cannot stage.
3. The controller runs isolated baseline/changed/reverted checks, preserving the
   stale proposal's revision and the actual Billing 8 artifact evidence.
4. Dev A proposes `combined-candidate` at dependency 8, sends an addressed request,
   and receives Dev B's acknowledgement bound to that exact tuple. Acknowledgement
   is a self-report, not independent proof. The registered checks verify actual
   integrated source bytes before publication.
5. The controller derives a restricted rule from the causal receipts, evaluates
   the frozen dataset, and records its activation. Existing static coordination
   checks remain; this baseline does not claim improvement over an equivalent
   static rule. Fresh policy epochs require fresh matching acknowledgements.

Each apply includes the same `operationKey` in its envelope and tool arguments.
Stage/check/apply have distinct command keys, while their internal runner key
binds the run, snapshot and complete version tuple. The stage result exposes it.

## Recovery and evidence

Every transition commits event, checkpoint, operation receipt and projection
atomically. Event payloads preserve the bounded reference workflow state; recovery
does not depend on process memory. Controlled effects have a durable started
intent before execution. Leases are renewed and fenced before state changes.

`crashAfterEffect(proof)` runs after actual publication and before the terminal
database commit. Recovery only accepts a runner publication proof matching that
same command's persisted authorization, version and operation. Other changes to
that pending publication are refused. A new command cannot adopt an old effect.
Runner proofs are checked against the exact operation, snapshot, artifact list,
registered checks, exit status and content digest.

The parent process test can kill the worker and restart against the same durable
storage. In-memory storage alone cannot prove persistence across process death.
Atlas mode must use separately authorized experiment data and credentials.

The service enforces only these domain operations. It does not monitor local
host actions, connect real Codex/Claude clients, deploy a server, or claim that
the fixed synthetic runner is an operating-system sandbox. The reference run is
bounded to 100 completed operations. Raw workflow state is controller-only;
personal context filters addressed messages and own changes.

Run package verification after building its dependencies:
`npm run build -w @context-plane/gateway`, `npm test -w @context-plane/gateway`,
and `npm run typecheck -w @context-plane/gateway` under the bundled Node 24 runtime.
