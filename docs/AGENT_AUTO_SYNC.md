# Automatic local reporting (issue #27)

The repository-scoped launcher runs **Claude Code 2.1.282 command hooks** and
reports supported session/tool boundaries to the existing hosted MCP and Atlas.
It does not require the model to remember a reporting prompt. No global hook,
background service, collection, model call or infrastructure is installed.
Node 22.12+ and this repository's `npm ci` dependencies are required.

## Start a covered client

Provide the existing project token through your private environment loader or
secret manager as `CONTEXT_PLANE_API_TOKEN`. Never paste it in commands, settings
files, issues or reports. From this repository:

```sh
export CP_SYNC_IDENTITY=shivraj:sync
export CP_SYNC_PERSON=Shivraj
export CP_SYNC_TASK=https://github.com/Simardeep27/ContextPlane/issues/27
node scripts/agent-sync/launch.mjs
```

Use your assigned identity/person and actual authorized issue URL. Allowed person
names are Shivraj, Simar, Buddhsen, Tanish. The launcher creates invocation-local
settings under ignored `.artifacts/context-sync`, passes them with `--settings`,
and removes them when the client exits. Normal Claude settings/permissions still
apply. It rejects `--bare`, `--safe-mode`, and overriding settings flags, which
can disable capture. It verifies the spool path is Git-ignored before launch.
It does not install or modify account-wide hooks. A new invocation still needs
human authorization for its underlying task and any model spend.

For a real client lifecycle check with **no model conversation**:

```sh
node scripts/agent-sync/launch.mjs --init-only --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

This uses Claude's documented `--init-only` lifecycle. `SessionStart` and
`SessionEnd` were observed on installed 2.1.282. Do not generalize that evidence to
other client versions. Tool-success, tool-failure and Stop inputs are covered by
isolated tests; they were not exercised with a paid live model turn.

## Captured data and identity

Only SessionStart, SessionEnd, Stop, and completion/failure of Bash, Edit, Write,
MultiEdit and NotebookEdit are reported. Reports contain an allowlisted task
reference, fixed action/outcome summary, sequence, time, stable event ID and
identity metadata. No command arguments, output, filenames, prompts, model
messages, transcripts, reasoning or error text is retained. Input is bounded to
1 MiB; oversize input fails visibly. Unknown tools/events are ignored.

Every launcher invocation has a fresh UUID `instanceId`; each native session
gets a hashed `sessionId` and a distinct identity such as
`shivraj:sync:hook-3aa11350bb3a9352`. This intentionally keeps concurrent clients
from competing for one agent's work-status. Registration metadata is stable and
an existing registration is reused. There is one current surface per effective
identity. The base identity is metadata, not an authentication credential.
Shared-token trust limitations from the sync contract still apply.

A tool completion means the client emitted a completion hook. `Stop` means the
turn stopped, and `SessionEnd` means the session ended. None marks the task
verified or `done`. These are `client_observation` reports with
`outcomeVerified: false`; they are not controlled executor receipts. The legacy
`work_finished` event type is used for a stopped boundary, explicitly qualified
by its summary and `stopped` status. The launcher additionally records its
observed process exit. No timestamp proves continued liveness.

## Delivery, interruption and bounds

Each report and exact status payload is atomically written and fsynced before
network I/O. Directories are mode 0700 and state files 0600. The private spool
permits at most 64 session directories, each with 256 pending reports, 4096
remembered event IDs and 2 MiB of serialized state. At capacity, capture fails
visibly with `OUTBOX_FULL`; it never silently evicts an unsent report. Review and
remove completed spools only after checking `pending: 0` and stopping clients.
One temporary state file can exist during atomic replacement; abandoned temps
are cleaned under the state lock on the next mutation. An interrupted launch may
leave its small settings file, which contains paths but no credential.

Tool-use IDs deterministically identify tool events. Session lifecycle keys are
stable within an invocation. Stop uses a hashed native prompt ID when available;
without it each invocation is a separate observation (no claim to deduplicate a
host retry without an event key). Retries always use the stored event ID and
exact body. Accepted messages survive a failed status write or lost reply;
replay uses the existing MCP message idempotency checks. No Atlas reset/seed or
direct database write is used.

The outbox serializes captures and delivery separately. It reads shared context
and inbox before delivery; a hook cannot perform inbox work, so any acquired
leases are returned with `success: false`. After `send_message`, it publishes
work-status and reads it back before removing the report from the queue.
Publication and message storage remain separate operations, not a transaction.
A local sequence orders updates; older queued snapshots cannot replace a newer
same-instance snapshot. Late tool callbacks after SessionEnd remain history and
do not reopen the session. Another instance or an unsequenced surface under the
same effective identity fails closed. This relies on the launcher being the only
writer of that unique identity; the existing server has no client-supplied CAS
or authenticated per-agent ownership to fence a malicious/external writer.

Reconnect retries happen at each covered hook and launcher exit. Requests have
five-second timeouts and delivery has a 20-second budget checked between calls.
A call already started can add up to five seconds. Failures print
`UNSYNCHRONIZED`; queued entries remain. The adapter does not silently launch an
offline daemon or acknowledge a handoff.

```sh
export CP_SYNC_REPO="$PWD"
node scripts/agent-sync/cli.mjs status
node scripts/agent-sync/cli.mjs flush
```

A killed process can leave a lock. Stop all covered clients before recovery:

```sh
node scripts/agent-sync/cli.mjs recover
node scripts/agent-sync/cli.mjs flush
```

Recovery refuses a live lock-owner PID. If a crash occurred before the PID file
was written, or the PID was reused, inspect the lock manually with every client
stopped; automatic lock theft would risk concurrent publication. Capture failing
before its durable write (disk full, capacity, lock timeout, forced termination)
is not claimed as captured. Already queued reports survive interruption. A
SIGKILL after the last successfully reported action may leave an old `working`
snapshot; readers must use freshness, not infer online status.

## Evidence and design rationale

`npm run test:agent-sync` builds MCP and runs 12 tests covering interruption/replay,
exact retries, bounds, concurrent capture, sanitization, stale-state behavior,
actual SIGKILL recovery and two independent MCP clients. Root `npm test` includes
these checks.
The adapter adds no shared MCP/API changes or dependencies. Tests use temporary
private local storage and isolated repositories, never team Atlas resets.

On September 26, 2026, real Claude Code 2.1.282 `--init-only` exited 0 and produced
three events (native start/end plus launcher exit), with zero pending. An
independent SDK client connected to hosted MCP as `shivraj:sync` and read the
persisted `stopped` surface, revision 2, for
`shivraj:sync:hook-3aa11350bb3a9352`, instance
`1e00a4b5-c698-462e-916a-cca1975f7166`, last event
`shivraj:sync:hook-3aa11350bb3a9352:66bd3fcfb1f1beee72c1c013678c9b1e`.
Those records describe this real lifecycle check, not fabricated team work.

Primary sources consulted September 26, 2026:

- [Claude hook reference](https://code.claude.com/docs/en/hooks): supported
  command-hook inputs, SessionStart/SessionEnd/tool events and the no-conversation
  `--init-only` path. The launcher uses this supported extension point.
- [MongoDB atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/):
  single-document writes are atomic; related writes across documents require
  transactions for atomicity. Existing separate message/status APIs are retained
  with explicit recovery, avoiding a server contract change for this adapter.
- [MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/):
  uniqueness supports stable logical identifiers. Existing MCP deterministic
  message `_id` plus exact-payload conflict checks provide retry deduplication.
- [MongoDB change streams](https://www.mongodb.com/docs/manual/changestreams/):
  streams report persisted database changes. They cannot capture a local shell
  action that no client sent, so adding one would not solve capture here.
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode):
  `codex exec --json` provides structured lifecycle output for a future wrapper.
  This PR does **not** implement or claim Codex desktop/CLI interception. Current
  Codex chats continue the manual sync contract.

Coverage is opt-in per launched Claude client. Unwrapped clients, custom MCP
tools, reads/searches, raw shell commands outside the client, remote sessions and
arbitrary private activity are outside this adapter. Explicit meaningful
self-reports remain necessary for decisions, concrete blockers, check evidence
and final task acceptance that hooks cannot infer safely.
