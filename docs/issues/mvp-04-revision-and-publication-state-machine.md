# MVP-04: Implement stale-revision detection and publication authorization

## Goal

Own the deterministic decisions between "developed against N" and "safe to
publish the exact corrected candidate."

## Scope

- Add the minimal core state machine for proposed, stale, staged, checked,
  authorized, published, and rejected candidates.
- Compare the candidate's dependency revision and policy epoch with current
  authoritative values during every pre-publish check.
- Reject Dev A's revision-`N` candidate after Dev B advances the dependency to
  `N+1`.
- Require acknowledgements from the consumers named by the active policy.
- Authorize publication only for the candidate hash whose registered checks
  passed under the current dependency revision and policy epoch.
- Emit domain events and projections; do not write storage directly.

## Acceptance criteria

- Tests prove stale dependency revision, stale policy epoch, wrong candidate
  hash, and missing acknowledgement cannot authorize publication.
- The exact coordinated candidate at `N+1` can be authorized.
- Every decision records machine-readable reason codes and evidence IDs.
- Repeating a command produces the same decision without duplicate events.

## Depends on

- MVP-01 and MVP-02.
