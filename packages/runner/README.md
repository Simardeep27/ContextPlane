# Registered synthetic runner

`ScenarioRunner(rootDir)` stages only the four registered Orders/Billing fixture snapshots. `check(snapshotId, operationKey)` executes fixed monetary-contract assertions against their actual TypeScript modules in Node 24. `publish(snapshotId, operationKey, expectedCandidateHash)` requires the matching successful check and revalidates the staged bytes. `reconcile(operationKey)` verifies an existing publication and returns its proof.

Use the same executor operation key for check and publish. `snapshotCandidateHash()` returns the fixture candidate identity, while each proof also includes hashes of the complete tested snapshot. Stale fixtures retain their declared candidate identity even when diagnostics execute against the newer consumer artifact.

The synthetic effect is an atomic rename of a prepared immutable publication directory containing both artifacts and its receipt. A worker dying after that effect and before a database receipt is saved can reconstruct the publication via `reconcile`; retrying cannot create a second publication under that key. This covers process interruption, not power-loss durability. No actual service deployment occurs.

The child has fixed executable arguments, a minimal environment, a five-second timeout, and an 8 KiB output cap. The runner rejects unknown snapshots, unsafe operation keys, changed artifacts, changed tests, and extra/symlink staged files. It executes only the registered synthetic source. This is a bounded child process, not OS-level filesystem or network isolation. The supplied directory must be caller-owned, without concurrent hostile filesystem writers. No arbitrary shell command API is exposed.
