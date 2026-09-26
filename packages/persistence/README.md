# Atlas persistence — issue #3

Implements `PersistenceAdapter` from the team's `wireframe` contracts at
`e6012cde284f1240830eba913f55ae134edd94db`. Product state uses the existing Atlas
cluster. The neighboring `harness-hackathon` project informed client reuse and
isolated transactional tests; its Python schemas and application were not copied.

## Run

From the repository root (Node 22+):

```sh
npm ci
npm run build
npm test
npm run typecheck
```

Default tests use `MemoryStorage` and **are not Atlas verification**. Live tests
require a runtime-injected `MONGODB_URI` and an explicit opt-in:

```sh
CONTEXT_PLANE_ATLAS_TESTS=1 npm run test:atlas -w @context-plane/persistence
```

The suite creates only `cp_persistence_test_<random UUID>` on that cluster and
removes that exact database in teardown. It ignores `MONGODB_DATABASE`, never
changes network access, and never provisions a cluster. If the test process is
forcibly killed, its temporary database can remain; remove only the identified
test database after inspection. Credentials are never written by this package.
Do not print raw driver errors; the storage boundary returns sanitized error codes.

## Integration

```ts
import {
  connectStorage,
  DurablePersistenceAdapter,
  MemoryStorage,
} from '@context-plane/persistence';

const connection = await connectStorage('context_plane_poc');
await connection.storage.initialize(); // idempotent required indexes
const persistence = new DurablePersistenceAdapter(connection.storage);
// Reuse this adapter/client for the life of one worker incarnation.
// Inject it where PersistenceAdapter is expected.
// await connection.close() on shutdown.

const fixture = new DurablePersistenceAdapter(new MemoryStorage());
```

Use one distinct adapter owner UUID per process incarnation. The default lease is
30 seconds, configurable between 100 ms and five minutes; renew well before
expiry during model or runner calls. Pool sizing stays at driver defaults until
actual worker concurrency is measured. Observe pool wait/checkout duration and
transaction conflicts before tuning. Operations and transaction retries are
bounded to 15 seconds, with a 10-second server-selection timeout.

The adapter stores and validates state; it does not authorize callers, select
runnable workflows, approve grants, compose projections, or promote rules. Scope
must be derived by the trusted API. `acquireLease` creates the lease record if
needed; **the caller decides whether the run should execute**, including blocked,
completed, or failed runs. There is no queue scanner or automatic resumption.

## Contract methods and additions

| Method | Behavior |
|---|---|
| `appendEvent(event)` | Trusted API append. Identical event-ID retry is a no-op; different content conflicts. Worker steps use `commitStep`. |
| `readEvents(scope, afterCursor?)` | Up to 100 committed events, exclusive cursor, ascending numeric order. Continue until an empty page. |
| `readProjection(scope)` | Latest caller-provided projection or `null`; no inferred workflow state. |
| `saveCheckpoint(checkpoint, lease)` | Requires active owner/generation and next checkpoint revision, starting at 1. Exact retries are no-ops. |
| `readReceipt(scope, key)` | Durable effect evidence for reconciliation, or `null`. |
| `saveReceipt(receipt, lease)` | Fenced insert; allows `started` → terminal. A terminal record is immutable. |
| `acquireLease(scope, runId)` | One winner; expired reclaim increments the generation. |
| `renewLease(scope, lease)` | Same generation, extended expiry, or `null` for lost/expired ownership. |
| `readCheckpoint(scope, runId)` **addition** | Retrieves progress after restart. |
| `saveProjection(projection, expectedRevision)` **addition** | Compare-and-set on prior projection revision; rejects cursor/policy-epoch regressions. |
| `commitStep({checkpoint, lease, event?, receipt?, projection?, records?, candidateHash?})` **addition** | One transaction across event, receipt, records, checkpoint, and optional projection. With `candidateHash`, every record naming a candidate must name that one. |
| `saveRecord({record, expectedRevision})` | Trusted API/seed write of one domain record (compare-and-set on the record's revision). |
| `readRecord(scope, kind, id)` / `listRecords(scope, kind)` | Scoped reads; list returns up to 100 records ordered by ID. |

The shared `LeaseToken` now carries `scope` (`ScopedLeaseToken` remains as a
deprecated alias). Pass back the **entire returned token**. Dropping scope is rejected. The adapter also checks its private
process owner ID; stealing another adapter's token does not transfer ownership.
These tokens are internal capabilities, not substitutes for API authorization.

Shared contracts remain unchanged. Suggested follow-up for Simar: incorporate
scoped tokens, checkpoint reads, atomic steps, and projection writes into the
shared interface. Grant/policy transaction entrypoints beyond projection CAS are
deferred until caller contracts exist. `appendEvent` has no lease in the shared
interface, so it must remain trusted API ingestion; do not expose it as a worker
domain tool or use it for worker effects.

## Domain records (MVP-01)

Records are defined in `@context-plane/contracts` (`records.ts`). Persistence
enforces only storage-level invariants; core still makes every decision.

| Record | Key | Guard enforced on write |
|---|---|---|
| `dependency_revision` | service ID | Head advances by exactly one revision. |
| `candidate` | candidate hash | `basedOn.candidateHash` equals the key; `basedOn.dependencyRevision` never exceeds the head (stale is allowed). |
| `check_result` | check ID | Immutable. |
| `publication_authorization` | candidate hash | Immutable. `authorized` requires the current dependency head, the stored projection's policy epoch, and referenced passing checks pinned to the same version tuple. |
| `policy_candidate` | policy candidate hash | Compare-and-set only. |
| `policy_version` | `agent@epoch` | Immutable, sequential per agent, and only with all unsafe cases caught and zero valid cases blocked. |

## Ordering, idempotency, and recovery

The shared contract supplies event cursors. Cursors are canonical zero-padded
decimal strings (`000001`, `000002`, …; width grows beyond six digits), sorted as
numbers, never timestamps or lexical strings. New appends must use the next
project cursor. A gap or competing cursor returns `CONFLICT`: reload committed
history and retry with the next cursor. Event IDs stay stable across retries.
Timestamp fields are evidence supplied by callers, not ordering authorities.

All mutations within a project write the same transactional project guard. This
deliberately serializes the small POC workload, provides a server clock, fences
lease changes against effects, and ensures a later cursor cannot become visible
before an earlier transaction commits. Different projects have independent
guards. This is a correctness-first POC, not a high-throughput event platform.
Mongo callbacks contain only database operations, never external effects. The
driver may retry a callback. See [MongoDB transaction guidance](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).

Checkpoint revisions are sequential independently of projection revisions.
Projection revisions may skip intermediate snapshots, matching the shared
fixture. Checkpoint event references cannot point into the future; completed
operation keys must resolve to succeeded receipts from that run. These checks
do not establish that the actual tests passed: the runner/core own verification.

Operation keys are unique **within org/project**, not per run. Reusing a key in
another run conflicts. `started` records may advance once to `succeeded` or
`failed`, preserving kind, attempt, run, and start time. Terminal evidence cannot
be replaced. Repeating the same result under a newer lease returns the original
receipt unchanged; a changed result hash/evidence conflicts. A new execution
after a terminal failure needs a new explicitly chosen operation key.

Recommended worker sequence:

1. Acquire a lease and load checkpoint/receipt.
2. If the operation is new, save a `started` receipt and checkpoint before the
   external effect. Generate stable IDs/timestamps outside retry callbacks.
3. Execute or reconcile through Shivraj's registered runner using the operation
   key and exact artifact hash. After a crash, **never infer that a missing or
   `started` receipt means the effect did not happen**.
4. Commit the terminal receipt, checkpoint, and event with `commitStep`.
5. After restart, claim a higher generation and resume from stored progress.
   The old worker can read/replay identical committed data but cannot mutate it.

There is no claim of exactly-once filesystem execution. The transaction makes
database evidence atomic; runner reconciliation closes the external-effect gap.
Payloads are bounded JSON (128 KiB, depth 20); evidence/completed-operation arrays
are capped at 100. Keep summaries bounded and use evidence IDs for larger data.

## Collections and indexes

Only five namespaced collections are created. Existing neighboring application
collections are untouched. Keys are unambiguous JSON tuples of org/project/key.

| Collection | Stored data | Indexes beyond `_id` |
|---|---|---|
| `cp_projects` | Transaction guard/server clock, cursor, optional projection | Unique `(orgId, projectId, key)` |
| `cp_runs` | Owner, generation, expiry, bounded checkpoint | Unique `(orgId, projectId, key)` |
| `cp_events` | Immutable event envelope and numeric cursor | Unique scope/key and scope/cursor |
| `cp_receipts` | Operation receipt keyed by operation key | Unique `(orgId, projectId, key)` |
| `cp_records` | Domain records keyed `kind:recordId` | Unique `(orgId, projectId, key)` |

Events and receipts are separate documents, not ever-growing arrays. No TTL,
vector index, graph, change stream, broad company ingestion, or unused parent
collections. Retention is explicit: no automatic deletion of reconciliation
evidence. Atlas reads use primary/majority; multi-document writes use snapshot
transactions with majority commit. A replica set/Atlas is required.

Errors: `INVALID_INPUT`, `CONFLICT`, `LEASE_LOST`, `IDEMPOTENCY_CONFLICT`,
`STORAGE_UNAVAILABLE`. An unavailable/ambiguous write must be reconciled by key
before retrying external work. Do not expose unrestricted `Storage` operations
to product agents; inject the adapter instead.

`MemoryStorage` executes the same adapter logic against atomic in-process drafts,
rolls back failed drafts, and accepts an injected test clock. It is only a fixture:
it cannot survive process death or prove MongoDB transaction/index behavior.
The live suite repeats the conformance checks against Atlas and separately checks
indexes and closing/reopening the database client.
