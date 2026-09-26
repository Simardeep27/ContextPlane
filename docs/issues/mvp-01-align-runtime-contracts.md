# MVP-01: Align runtime contracts with durable persistence

## Goal

Make the shared contracts sufficient for the API, worker, runner, and policy
flow to use persistence without importing concrete implementation-only types.

## Scope

- Add project-scoped lease tokens to the shared contract.
- Add `readCheckpoint`, `saveProjection`, and atomic `commitStep` to the shared
  persistence boundary.
- Define the minimal records for dependency revisions, staged candidates,
  check results, publication authorization, policy candidates, policy versions,
  and their evidence references.
- Keep all mutable records scoped by `orgId` and `projectId` and guarded by an
  expected revision, dependency revision, policy epoch, or lease generation.
- Update persistence to implement the final shared interface directly.

## Acceptance criteria

- No API or worker package needs to import types from persistence internals.
- Type tests reject cross-project leases and stale version tuples.
- An atomic step can contain an event, operation receipt, checkpoint, and
  projection while preserving one stable candidate hash.
- Existing contract and persistence conformance tests pass.

## Non-goals

- New workflow behavior, UI, or runner implementation.
