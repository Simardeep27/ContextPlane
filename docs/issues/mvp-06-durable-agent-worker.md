# MVP-06: Run and resume the durable agent workflow

## Goal

Connect scoped context, model turns, deterministic tools, and the exact-candidate
runner in a worker that survives one deliberate restart.

## Scope

- Add a single-process worker that claims one run with a fenced lease.
- Compose role-specific context and tool allowlists from authoritative state.
- Route every model turn through OpenRouter and record the returned model and
  token/latency metadata.
- Validate tool calls server-side and dispatch only registered tools.
- Write a `started` receipt and checkpoint before each external effect.
- Reconcile the operation, then atomically commit its terminal receipt, event,
  checkpoint, and optional projection.
- Resume a reclaimed run from its durable checkpoint without repeating a
  completed publication.

## Acceptance criteria

- A scripted run reaches the stale-revision blocker and later completes with
  the corrected candidate.
- Killing the worker after one durable effect and restarting it does not
  duplicate that effect.
- A stale worker generation cannot commit after another worker reclaims the run.
- Recorded inference metadata identifies the actual OpenRouter model.
- The agent cannot invoke a tool outside its role allowlist.

## Depends on

- MVP-01, MVP-03, MVP-04, and MVP-05.
