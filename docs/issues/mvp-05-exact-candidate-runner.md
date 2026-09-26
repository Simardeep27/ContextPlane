# MVP-05: Stage, test, and publish only the exact candidate

## Goal

Close the gap between a logical candidate hash and the artifact actually tested
and published.

## Scope

- Implement the registered runner adapter for a fixed allowlist of demo checks.
- Stage artifacts in an isolated temporary directory keyed by candidate hash.
- Verify all artifact hashes before running checks.
- Record baseline, failing stale candidate, corrected candidate, and publication
  receipts with stable operation keys.
- Implement reconciliation by operation key after an ambiguous result.
- Make publication a synthetic, idempotent operation for the demo.

## Acceptance criteria

- Unregistered commands and arbitrary arguments cannot execute.
- Modifying the staged artifact after checks invalidates publication.
- The stale candidate produces the expected consumer failure.
- The combined candidate passes unit and cross-service checks.
- Only the passed candidate hash can produce a publication receipt.

## Depends on

- MVP-01 and MVP-04.
