# MVP-03 verification — September 26, 2026

## Local gates

| Command | Result |
|---|---|
| `npm run build` | PASS, all four workspaces |
| `npm run typecheck` | PASS, all four workspaces |
| `npm test` | PASS, 32 tests total |
| `git diff --check` | PASS |

The four API integration tests use `MemoryStorage` and cover the revision 7 → 8
context transition, exact idempotency replay, conflicting idempotency reuse,
cross-project and wrong-agent rejection, evidence-reference-only context, and
cursor-resumable event reads.

## Atlas reconnect gate

The opt-in Atlas test passed:

```sh
CONTEXT_PLANE_ATLAS_TESTS=1 node --env-file=harness-hackathon/.env \
  --import tsx --test apps/api/test/atlas.test.ts
```

Observed result: **1 passed, 0 failed**. The test created an isolated
`cp_api_test_<UUID>` database, persisted the Dev B publication, closed the
client, opened a new connection, recovered revision 8 and its evidence pointer,
and removed that exact temporary database during teardown.
