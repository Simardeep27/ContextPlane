# Dev A / Dev B scenario (MVP-02)

Deterministic, synthetic fixture for the minimum demo. Dev B (Orders) owns
`svc-orders-api`; Dev A (Billing) owns `svc-billing`, which consumes the Orders
`OrderTotal` contract. Revision `N` = 7 is seeded; Dev B's publication of `N+1`
= 8 is provided as a command (`devBPublication`) for the API to ingest.

```sh
npm run scenario:seed      # from the repo root; resets and seeds the scenario
```

With `MONGODB_URI` (root `.env`), it writes to Atlas database
`MONGODB_DATABASE` (default `context_plane_poc`), deleting only the fixed
`org_demo/project_dev_coordination` scope first. Without it, it validates the
seed against an in-memory store. It prints a credential-free manifest.

| Fixture | Contents |
|---|---|
| `artifacts` | Orders contract at N and N+1; Billing code for the stale and combined candidates (hashes are sha256 of content). |
| `candidates.stale` | Dev A's candidate built on N; its cross-service check is expected to fail at N+1. |
| `candidates.combined` | Billing adapted to N+1; the exact candidate expected to pass and publish. |
| `devBPublication` | Idempotent `dependency.publish` command advancing Orders to N+1. |
| `policyDataset` | Frozen MVP-07 evaluation cases: 2 unsafe, 2 safe, 1 unrelated failure. |
| `seeded*` | What the seed writes: 2 events, dependency head N, Dev A candidate at N, projection revision 1 (policy epoch 0). |

Hashes are pinned in `test/scenario.test.ts`; changing any fixture input must
update them deliberately.
