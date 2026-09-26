# Steward cron and heartbeat time series

## Hosted steward (Vercel Cron)

`apps/hq/api/steward.ts` runs daily at 12:00 UTC (`crons` in `apps/hq/vercel.json`; Vercel Hobby allows only daily crons — on Pro set `*/10 * * * *`). Trigger it on demand with an authorized GET to `/api/steward`.
It requires `Authorization: Bearer ${CRON_SECRET}` (401 otherwise), registers
`company:steward`, reads the last 24 hours through `read_ledger`, drops heartbeats,
and appends episodes and insights through `remember`. It shares the pure logic in
`apps/hq/shared/distill-core.mjs` with `scripts/brain/distill.mjs`, so reruns write
nothing and changed input supersedes the previous entry for the same key.
`company:steward` needs no allowance: only principles are restricted to `human:*`
and `*:primary`. Limitation: `read_ledger` is a sanitized projection, so episodes
are keyed by sender identity and `createdAt` instead of the reported actor, instance
and `occurredAt` that the direct-Mongo script uses. The team page shows the newest
insights from the `get_context` brain digest (title, author and time only).

## Heartbeat time series

`cp_agent_heartbeats` is a time-series collection (`ts`, `meta` = identity, scope,
org and project; minute granularity; 7-day `expireAfterSeconds`). A human creates it
with `node scripts/atlas/create-timeseries.mjs [--dry-run]` (idempotent). No other
TTL index is added: run leases are ISO strings inside project documents, and inbox
leases sit on the durable ledger, which must not expire.
`coordinationHandlers` accepts an optional heartbeat sink that records
`type: heartbeat` messages best-effort; `hourlyHeartbeats` aggregates them per hour.
Next step: pass `mongoHeartbeatSink(...)` in `packages/mcp/src/main.ts` (deferred to
avoid a concurrent edit), then expose `hourlyHeartbeats` on the team page.
