# Context Plane HQ

A live 3D command center for work performed by AI agents across a company.
Each employee's agent is a character whose state (investigating, coding,
waiting for approval, blocked, testing, coordinating, complete) comes from
recorded events. Lines show dependencies between agents, and messages travel
along them as they are sent. Click an agent to see its objective, latest
action, evidence, blocker, estimated completion and messages. Ask "What is
everyone working on?" for a live answer that cites the events behind every line.

HQ shows **observable work state only**: events, tool calls, test results,
approvals and timestamps stored in MongoDB. It never displays model reasoning.

## Run it

```sh
npm install
cp .env.example .env   # add MONGODB_URI for the Atlas sandbox (optional)
npm run dev            # API on :8787, UI on http://localhost:5173
```

Without `MONGODB_URI` the server uses an in-memory store and the UI shows
"In-memory". With it, events go to `context_plane.hq_events` and arrive live
through a change stream. If change streams aren't available, the server falls
back to polling.

Production-style: `npm run build && npm start` serves the UI and API on `:8787`.

## Runtime mode (MVP-08)

Point HQ at the Context Plane runtime instead of the scripted demo:

```sh
# terminal 1, repo root: the MVP-03 Context API on Atlas
PORT=3001 node --env-file=.env apps/api/dist/server.js     # after npm run build
# terminal 2: HQ reading that API
CONTEXT_API_URL=http://localhost:3001 npm run dev -w @context-plane/hq
```

HQ polls the API's projection and events (never MongoDB directly), maps Dev A
to the Orders character and Dev B to Billing, and shows the dependency
revision (N vs N+1), artifact and evidence, policy epoch, projection revision,
runs, and which runtime pieces are not reported yet. "Dev B publishes N+1"
sends the scenario's idempotent publication through the API. Agent state comes
only from stored runs and addressed messages; refreshing rebuilds the page from
persisted data. Set `CONTEXT_PLANE_DATABASE` on the API to use a separate
database from the shared `context_plane_poc`.

## Demo script (about 1 minute)

1. Click **Start checkout API change**. Orders proposes the v2 change, and Billing and Notifications light up as affected.
2. Notifications patches and tests its receipts and completes. Billing blocks waiting on Orders' new currency contract.
3. Orders' integration tests need staging data. It blocks and files an access request.
4. Click **Approve as Dana** (only a human owner can decide).
5. Orders resumes, runs the tests, publishes the contract and tells Billing. Billing tests and finishes. PM closes the rollout.
6. Ask "What is everyone working on?", click any citation, or open **Evidence trail** to audit every step.

`SCENARIO_PACE=0.5` plays the scripted part at double speed.

## How it fits together

- `shared/events.ts`: event envelope (same shape as `EventEnvelope` in
  `@context-plane/contracts`) and the HQ event types. This is the integration
  contract: any runtime that writes these documents to `hq_events` shows up in HQ.
- `shared/projection.ts`: folds events into agent states, links, access
  requests and the timeline. Every displayed field keeps the `eventId` it came from.
- `shared/ask.ts`: deterministic manager answers built from the projection, with citations.
- `server/`: event store (MongoDB or memory), SSE stream (snapshot followed by
  live events), access decisions, and `scenario.ts`, the scripted driver that
  stands in for the agent runtime during the demo. The scripted events are
  labelled as such. The approval is always real human input.
- `src/`: React + react-three-fiber scene and panels.

## Checks

```sh
npm test         # projection + manager answer tests (node:test via tsx)
npm run typecheck
```
