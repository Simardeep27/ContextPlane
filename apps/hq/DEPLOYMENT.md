# Company Harness team view on Vercel

Issue #28 / parent #2. The team page reads actual `work-status` / `team-context`
surfaces through the existing hosted MCP. It does not start the migration API,
seed records, connect to MongoDB, or create another ledger. The existing migration
page remains at `/index.html` with its original local runtime commands.

## Vercel setup

Import this ContextPlane repository and choose **Root Directory `apps/hq`**.
Enable inclusion of source files outside that directory (workspace dependencies).
Use Node 24, the Vite framework, the committed build command, and output `dist`.
The Vercel function is `api/team.ts`; `/` rewrites to `team.html`.
Deploy a preview from the reviewed commit before promoting it.
When deploying from the repository root with the CLI, pass
`--local-config apps/hq/vercel.json` so the team-page rewrite is applied.
Vercel assigns the first deployment to production automatically; verify it
before sharing. Use `.js` relative imports in the function dependency graph
so Vercel's emitted JavaScript resolves at runtime.

Set these **server-side** variables for the intended deployment environment:

- `CONTEXT_PLANE_API_TOKEN`: existing hosted MCP project token, supplied privately.
- `HQ_VIEW_PASSWORD`: a separate random viewer password of at least 24 characters.
  Never reuse the MCP token. Supply it through provider secret UI / hidden terminal
  prompt, and share it with the four teammates privately. Rotate to revoke sessions.

Never prefix secrets with `VITE_`, commit `.env`, paste secrets into chat/issues,
or invoke header helpers where their output will be logged. No Atlas URI is needed.
The MCP endpoint, reader identity (`shivraj:ui`) and scope are fixed server-side.
The reader registration must already exist; the UI never registers or writes agents.

Enable Vercel Authentication for the preview. Confirm the chosen protection also
covers the final domain before promoting. The application additionally denies all
team reads without its signed, HttpOnly, SameSite=Strict viewer cookie; it fails
closed if either secret is missing. Sessions expire after eight hours. HTTPS uses
Secure cookies. The static shell contains no team state. This is shared-team access,
not per-person authorization. Apply Vercel Firewall rate limiting to the sign-in
route if exposed beyond this small trusted team; do not purchase a plan automatically.

## Verification

```sh
npm ci
npm run build -w @context-plane/contracts
npm run build -w @context-plane/scenario
npm run typecheck -w @context-plane/hq
npm run test -w @context-plane/hq
npm run build -w @context-plane/hq
```

For local team-only verification, supply the same variables securely to
`npm run dev:team:server -w @context-plane/hq` (port 8788), then run
`PORT=8788 npm run dev:web -w @context-plane/hq` and open `/team.html`.
The Vite proxy preserves the browser Host for same-origin cookie/login checks.
Neither command starts the migration API or simulation.

Before claiming deployment complete, verify unauthorized `/api/team` returns 401,
sign-in works, all four people and distinct identities display, refresh observes
another actual client's report, and an MCP failure is visible. Test mobile and
sign-out. Inspect built JS and responses for credentials without printing them.
Record the commit, URL, exact checks and any incomplete acceptance in the PR.

The UI polls every five seconds while visible. Overlapping requests are skipped;
timeouts and errors retain a clearly labelled last successful snapshot. Reports
older than 15 minutes are stale; missing/future timestamps are unknown. Neither
freshness nor a registration means online. All task status is self-reported,
including `done`. The source returns only the latest 100 surfaces; the UI warns
when that window may hide older reports. Person grouping uses the identity prefix
or the report's declared person (including Buddhsen); it is not authenticated
personal ownership. Unmatched identities appear under Other. Only presentation
fields are returned; inboxes, registrations and arbitrary content keys are omitted.

## Hosting decision and official references

Vite static assets plus one Node.js Vercel Function replace the laptop server for
this page. The existing loopback/SSE migration server is not deployed as a daemon.
The function uses the documented Web Standard `fetch` export and no new framework.

- https://vercel.com/docs/frameworks/frontend/vite
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication

Reviewed September 26, 2026. Provider protection is configuration, not an assumption
made from browser headers. No productivity chart is inferred from reports.
