# Context Plane HQ

A React/Vite 3D view of recorded project state. This is a local demonstration
surface, not an authenticated multi-user application. It has two explicit modes.

## Read-only runtime view (default)

From the repository root, build the shared packages and HQ with `npm run build`.
Start the existing Context API in a separately configured, isolated environment,
then run:

```sh
CONTEXT_API_URL=http://127.0.0.1:3001 npm run dev -w @context-plane/hq
```

Open `http://127.0.0.1:5173`. HQ polls the existing API's projection and cursor-based
events for the fixed MVP-02 project, then forwards presentation fields over SSE.
It uses the API's existing `dev-a` demo read session; this is not production
identity authentication. HQ never connects to MongoDB or creates another ledger.
Do not provide it with a database credential. The API owns database isolation.

Run publication and other domain commands through authenticated agent clients.
HQ cannot publish as Dev B or approve requests: all mutation routes return 403
in runtime mode. The runtime URL defaults to `http://127.0.0.1:3001`; an unavailable
API appears offline and never silently falls back to simulation. URL credentials,
query strings and fragments are rejected. API connection details and arbitrary
payload fields are not sent to the browser.

The current adapter displays dependency revisions and evidence IDs, proposed
code version when reported, policy epoch, runs, blockers, addressed messages and
the event timeline. It does **not** yet show complete staged/tested/published hash
matching, publication authorization, rule evaluation/activation or sanitized
receipt bodies. An epoch, reported run completion or event count does not prove
verified productivity. MVP-08 remains partial. The two other characters are
explicitly marked as having no connected runtime agent.

Refresh reconstructs the view by reading the API again. Failed polling retains
the last state and marks it potentially stale. The storage backend is not inferred
from the connection; Atlas and persistence require separate evidence.

## Explicit simulation

```sh
HQ_MODE=simulation npm run dev -w @context-plane/hq
```

This mode uses memory only and ignores `MONGODB_URI`. The UI prominently labels
all work, test results and identities as fictional playback. Click **Start
simulation**, inspect the characters, then **Simulate approval** or **Simulate
denial**. These controls advance playback without executing tests, authenticating
a resource owner or granting real access. Reloading the page reads this process's
memory; restarting the server clears it. `SCENARIO_PACE=0.5` doubles playback speed.

Simulation writes require an ephemeral capability fetched by the browser, an
allowed Origin and JSON content type. Both servers bind to loopback; the default
browser origin is `http://127.0.0.1:5173`. Set `HQ_BROWSER_ORIGIN` only when using a
different local browser origin. This capability is a CSRF boundary, not user auth.

## Build and verification

```sh
npm run typecheck -w @context-plane/hq
npm test -w @context-plane/hq
npm run build -w @context-plane/hq
npm start -w @context-plane/hq
```

The last command serves built assets and the API at `http://127.0.0.1:8787`.
`PORT` changes the HQ server port. Tests use local HTTP fixtures and memory only,
covering cursor pagination, reload reconstruction, concurrent polling, stale
state, presentation allowlists, shutdown, disabled runtime writes, and rejected
cross-origin or missing-capability simulation requests. These tests do not prove
an Atlas deployment or connection to a real agent client.

`shared/events.ts` describes fictional presentation events; it is not a product
schema. Real data stays in the shared contracts and flows through
`server/runtime.ts` → `shared/runtime.ts` → scene and panels. `shared/ask.ts`
produces deterministic answers with citations; it makes no model calls.
