# Automatic local reporting (issue #27)

The repository-scoped launcher runs **Claude Code 2.1.282 command hooks** and
reports supported session/tool boundaries to the existing hosted MCP and Atlas.
It does not require the model to remember a reporting prompt. No global hook,
background service, collection, model call or infrastructure is installed.
Node 22.12+ and this repository's `npm ci` dependencies are required.

## Out of the box (no launcher)

Every Claude Code session opened in this repo (terminal or desktop) runs the
hooks in the committed `.claude/settings.json` and gets the `context_plane` MCP
server from `.mcp.json`, once you trust the project. One-time setup:

1. `git pull && npm ci`.
2. Export `CONTEXT_PLANE_API_TOKEN` from your secret store (e.g. Keychain) in your shell profile.
3. `export CP_SYNC_PERSON=<Shivraj|Simar|Buddhsen|Tanish>` (else inferred from `git config user.name/email`).

Identity defaults to `<person>:<branch-slug>`, the task to issue #27 (`CP_SYNC_TASK`
overrides), and the recipient to `<person>:primary` (`CP_SYNC_RECIPIENT` overrides).
With no token or person, hooks do nothing; failures print one stderr line and exit 0.
Codex is not covered this way. The launcher below still works and takes precedence.

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
turn stopped and the agent is waiting for input: it reports a `progress` event
with `waiting: true` and `idle` status, never finished. `SessionEnd` means the
session ended. None marks the task verified or `done`. These are
`client_observation` reports with `outcomeVerified: false`; they are not
controlled executor receipts. The legacy `work_finished` event type is used only
for the SessionEnd boundary, explicitly qualified by its summary and `stopped`
status. The launcher additionally records its
observed process exit. No timestamp proves continued liveness.

## Delivery, interruption and bounds

### 60-second launcher heartbeat

Both `launch.mjs` (Claude) and `launch-codex.mjs` (Codex) now attempt a
`heartbeat` report every 60 seconds through the existing MCP outbox while their
child process is alive and its last covered observation is working or blocked
(not idle after Stop).
Start through the launcher commands above to enable it. No server cron, service
deployment, detached daemon, new credentials, or model call is needed.

A heartbeat preserves the last observed activity summary and status. Its
`heartbeatAt` is separate from `lastActivityAt`; `outcomeVerified` remains false.
It observes process presence, not useful progress or a completed task. A blocked
tool remains blocked. `Stop` pauses heartbeats; a subsequent covered tool event
resumes them, and `SessionEnd` disables them. Because these adapters do not capture
prompt submission, a new turn after Stop is uncovered until its first covered
tool event. SessionStart alone also does not prove a turn is busy. A hung client
can still have a live process. Consumers should show heartbeat freshness and
actual activity age separately, and treat missed heartbeats as unknown/stale.

Only hook-created sessions belonging to this launcher invocation are covered.
Ordinary Claude project-settings hooks still report events but have no periodic
timer. Existing sessions, desktop clients, and unwrapped invocations are not
automatically enrolled. Everyone must pull this change and start a covered
launcher session; existing Codex hook trust requirements still apply. The shared
server cannot force a remote client to report or infer activity from silence.

Ticks never overlap. Pending reports are retried before another heartbeat is
created, so an outage does not add a heartbeat backlog each minute. Delivery
delays, native-hook contention, machine sleep, and network failure can postpone
the 60-second attempt; this is not a delivery deadline guarantee. Launcher exit
cancels the timer and drains its current tick before publishing the final stop.
Force-killing the launcher leaves only already captured reports for recovery.
Heartbeats share the existing bounded spool/remembered-ID budget described below;
long sessions can reach that limit and will report `UNSYNCHRONIZED`.

The heartbeat tests use a controlled timer with the production 60,000 ms interval
and exercise active/blocked/idle/ended state, exact outage retries, bounded queue
growth, overlapping ticks, and shutdown drain. They do not establish that every
teammate has adopted the launcher or that a native session has run live.

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

## Opt-in native Codex adapter

`scripts/agent-sync/launch-codex.mjs` adds an explicit Codex CLI entry point.
The existing Claude launcher stays separate. Current Codex chats, desktop chats,
and ordinary `codex` launches are **not enrolled** by installing these files.
No permission policy, sandbox setting or hook trust is changed.

From this checkout, prepare its project-local hook definition:

```sh
node scripts/agent-sync/launch-codex.mjs --setup
codex
```

In Codex, use `/hooks` to inspect and trust the generated command definitions,
then exit. New or changed definitions require review again. Setup refuses to
replace an existing different `.codex/hooks.json`; preserve and reconcile that
configuration before proceeding. The generated file contains local absolute
paths and is excluded through Git's local `info/exclude`.

Start a covered session with the existing private loader. This passes only the
MCP token and optional endpoint from the team environment, never database or
provider credentials. It prints no secret and keeps normal Codex permissions:

```sh
node --input-type=module -e '

import { spawn } from "node:child_process";
import { loadTeamEnvironment } from "./scripts/team-environment.mjs";
const team = loadTeamEnvironment();
const child = spawn(process.execPath, ["scripts/agent-sync/launch-codex.mjs"], {
  stdio: "inherit",
  env: { ...process.env,
    CONTEXT_PLANE_API_TOKEN: team.CONTEXT_PLANE_API_TOKEN,
    ...(team.CONTEXT_PLANE_MCP_URL ? { CONTEXT_PLANE_MCP_URL: team.CONTEXT_PLANE_MCP_URL } : {}),
    CP_SYNC_IDENTITY: "shivraj:codex", CP_SYNC_PERSON: "Shivraj",
    CP_SYNC_TASK: "https://github.com/Simardeep27/ContextPlane/issues/27" },
});
child.on("error", () => { console.error("Codex launch failed"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
'
```

Use your actual assigned task/person/base identity. The launcher allocates a new
instance and unique effective identity for each native session. Hook registration
metadata says `codex-hooks`. The hook command is inert without the launcher's
enrollment environment. A launcher exit without any captured hook reports fails
visibly as `UNCOVERED`; it cannot assert that trusted hooks were active.

Covered events are native SessionStart, SessionEnd, Stop, and PostToolUse for
Bash/apply_patch. PostToolUse is not a success receipt: Codex also emits it for
nonzero Bash exits. A structured numeric `tool_response.exit_code` can classify a
failure; opaque or other tool responses remain explicitly unverified. Raw
responses, commands, patches, transcript paths and conversation text are never
stored. Stable native tool/turn IDs deduplicate reports where available.

SessionEnd only enqueues with a 250 ms state-lock wait. It starts no network
request; the launcher flushes after process exit. Other covered hooks enqueue,
then attempt ordinary bounded delivery. SDK imports occur only for delivery.
A blocked state lock fails visibly; no lock is stolen. Slow disk writes or forced
termination before durable capture remain possible. Captured pending reports
survive and can use the existing `status`, `recover`, and `flush` commands with
the same private token environment. No background process is installed.

Official [Codex hook documentation](https://learn.chatgpt.com/docs/hooks)
describes project hooks, exact-definition trust review, Bash/apply_patch coverage,
and the three-second SessionEnd maximum. Specialized/hosted tool paths may be
outside native tool-hook coverage. Installed CLI `0.153.4` was inspected; its help
exposes hook trust controls. No trust-bypass flag is used by this adapter.

Validation: `npm run test:agent-sync` includes Codex normalization/sanitization,
stable IDs, capture without credentials/network, state-lock timeout, unenrolled
inert behavior, and independent MCP reader/replay tests for both clients. These
are isolated fixtures, not evidence of a paid native model turn. A real native
Codex hook lifecycle and hosted readback must be verified after the human trust
step. Do not claim this already enrolls the current coordinator conversation.

Until enrolled, Codex follows [AGENT_SYNC_CONTRACT.md](AGENT_SYNC_CONTRACT.md):
read context and inbox, send a stable-ID meaningful report, publish own
work-status, and read back its lastEventId. Report at least every five minutes
and at handoff. A denied connector action must not be retried through another
transport to evade approval.
