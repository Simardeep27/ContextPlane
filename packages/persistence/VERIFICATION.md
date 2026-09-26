# Persistence verification — September 26, 2026

Branch: `buddhh/atlas-persistence`.
Shared contract source: `wireframe` at `e6012cde284f1240830eba913f55ae134edd94db`.
The commit containing this report records the tested implementation.

## Local checks

| Command | Observed result |
|---|---|
| `npm run typecheck` | PASS, both workspaces |
| `npm test` | PASS: 5 shared-contract tests + 17 persistence fixture tests |
| `npm run build` | PASS, both workspaces |
| `git diff --check` | PASS |
| Credential-pattern scan of persistence source/config/docs/tests | 0 matches |

`npm install` reported zero dependency vulnerabilities. The first test run found
a shallow-copy bug in the test fixture helper, which was corrected. The adapter
kept the stored event unchanged throughout that test.

## Live Atlas checks — separate evidence

Executed from this repository root using the already configured neighboring
project's runtime environment file, without copying or printing credentials:

```sh
CONTEXT_PLANE_ATLAS_TESTS=1 node --env-file=../harness-hackathon/.env --import tsx --test packages/persistence/test/atlas.test.ts
```

Final run: **19 passed, 0 failed, 0 skipped, 0 cancelled; 51.281 seconds**.
The first sandboxed connection attempt timed out; the authorized network run
succeeded. A previous live run also passed all 18 tests before the final retry
regression check was added and reconnect receipt assertions were strengthened.

Observed against the existing Atlas cluster:

- Shared blocked/resumed/completed event and projection fixtures round-trip.
- Concurrent identical event and operation retries produce one committed result.
- Different event content and changed terminal receipt evidence are rejected.
- Project/org reads are isolated; cross-scope tokens are rejected even with
  matching run IDs and generations.
- Six concurrent claimants yield one winner; reclaim increments generation.
- Different-owner, expired, and stale-generation writes are rejected.
- Checkpoint compare-and-set rejects stale/concurrent competing revisions.
- Started receipts can be reconciled under a new lease and finalized once.
- A new adapter reclaims the run and recovers its checkpoint/receipt; old-worker
  writes cannot commit.
- Transaction failure rolls back earlier event/receipt writes and cursor advance.
- A full step retry adds no duplicate evidence, and cannot attach a new effect
  to an already committed checkpoint revision.
- Event cursors resume exclusively in committed numeric order.
- Required scope/key and scope/cursor unique indexes exist.
- Closing and reopening the MongoDB client preserves checkpoint and receipt
  evidence, and allows reclaim at generation 2.

Each live run created a fresh `cp_persistence_test_<UUID>` database containing
only its four namespaced collections. Successful teardown removed that exact
temporary database. No existing application collections, Atlas access lists,
or cluster provisioning were changed.

## Integration work remaining

- Simar must wire the adapter into API/worker code. That runtime is not present
  on the imported contracts branch; no end-to-end agent workflow is claimed.
- Review additive `ScopedLeaseToken.scope`, `readCheckpoint`, `saveProjection`,
  and `commitStep` for inclusion in shared contracts. Shared files were unchanged.
- Worker paths must use `commitStep` for atomic evidence, not unfenced API-only
  `appendEvent`. Callers retain responsibility for runnable-state decisions,
  authorization, grant transitions, and policy promotion.
- Restart evidence is a storage crash/reclaim fixture plus separate client
  reconnection, not a process-kill test of the eventual worker or runner.
- External filesystem effects still require registered-runner reconciliation.
- Grant/policy transition methods await their caller contracts; the current
  projection CAS is not a grant authority or a complete promotion transaction.
