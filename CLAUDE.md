# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Context Plane HQ is the 3D visualization for Context Plane (hackathon project; the agent runtime lives in a separate repo, `Simardeep27/ContextPlane`). It renders observable agent work from an event log in MongoDB — never model reasoning.

## Commands

```sh
npm run dev        # tsx watch server (:8787) + Vite (:5173, proxies /api)
npm test           # tsx --test shared/*.test.ts
npx tsx --test --test-name-pattern="denial" shared/projection.test.ts   # single test
npm run typecheck
npm run build && npm start   # server also serves dist/
```

Env (`.env`, loaded via `process.loadEnvFile`): `MONGODB_URI` (absent → in-memory store), `MONGODB_DB` (default `context_plane`), `PORT`, `SCENARIO_PACE` (multiplier on scripted delays).

## Architecture

Data flows one way: **events → projection → UI**. Nothing in the UI holds state that isn't derived from events.

- `shared/events.ts` — the integration contract. Envelope mirrors `EventEnvelope` from `@context-plane/contracts` (scope, runId, actor, revision, cursor, occurredAt, payload). `PayloadByType` defines the HQ event types; adding a type means updating `hqEventTypes`, `describeEvent`, `applyEvent`, and `agentsOf`/`evidenceIdsOf` in `shared/projection.ts`. Unknown event types in the collection are ignored.
- `shared/projection.ts` — pure fold of events (sorted by `revision`) into `HQView`. Displayed fields are `Traced<T>` so they carry their source `eventId`. Blocked/waiting/complete agents are "held": only `run.resumed`/`run.completed`/`access.decided` move them, so their own messages or tool calls don't make them look busy.
- `shared/ask.ts` — deterministic manager Q&A over the projection (keyword intent → filter → sentence + citations). Deliberately no LLM.
- `server/store.ts` — `hq_events` collection, unique index on `(scope.projectId, revision)`; appends are serialized and retried on duplicate key. Live delivery via change stream, falling back to `_id`-cursor polling. In Mongo mode `append` does not emit directly — the watcher does, so events written by other processes appear too.
- `server/index.ts` — plain `node:http`. `GET /api/stream` is SSE: subscribes first, sends a `snapshot` of the project, then de-dupes live `event`s by revision; `meta` events announce project/scenario changes (clients follow a new projectId). `POST /api/access/decide` validates against the projection and records the decision as a human actor.
- `server/scenario.ts` — scripted demo driver standing in for the agent runtime. Each "Start" creates a new projectId (`checkout-v2-<stamp>`); phase two runs only after a human decision. Scenario status is re-inferred from history on restart.
- `src/scene/` — react-three-fiber. Characters are built from primitives; per-state animation lives in `AgentCharacter`'s `useFrame`. Animations for "happening now" (shockwaves, packets, link flashes) key off `live` receipts (events that arrived over SSE, not the snapshot), so reloading doesn't replay them.

Gotcha: HTML labels (`drei` `Html`) sit inside the canvas container, so their clicks also reach r3f as pointer misses — `onPointerMissed` ignores targets inside `.agent-label`.
