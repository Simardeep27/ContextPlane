# Hosted coordination MCP

Verified September 26, 2026 for [issue #3](https://github.com/Simardeep27/ContextPlane/issues/3).

Endpoint: **https://context-plane-brain.buddhsen-work.workers.dev/mcp**

This serves the existing coordination MCP independently of the local team-stack
launcher. Use the same project token supplied privately by the team. The service
has project-token authentication; caller-declared agent names are not individual
credentials. Native client reloads and cross-person acceptance remain separate
from server deployment checks.

## Deployment identity

- Source commit: `73a9106684927d36a0809be5c63161376d28cf02`.
- Base: `main` at `19a5894`.
- Worker version: `bdff3753-2963-41a7-a50e-b67787c35c7d`.
- Container image digest: `sha256:4ad8c401c3dd5cfa1a6bc0adefa0cd266207d92ed8597b8c35499c8b999c2b49`.
- Existing Worker: `context-plane-brain`; existing container class/binding:
  `BrainContainer` / `BRAIN`; existing instance name: `iteration-0`.

The deployment preserves the existing application and durable-object identity.
The code is the nine-tool MCP already on main; this change corrects its hosting
configuration and generated bindings.

| Setting | Value / source |
| --- | --- |
| `MONGODB_DATABASE` | `context_plane` |
| `CONTEXT_PLANE_ORG_ID` | `org_synthetic_demo` |
| `CONTEXT_PLANE_PROJECT_ID` | `project_mvp_02` |
| `CONTEXT_PLANE_COORDINATION_SCOPE` | `project:context-plane` |
| `MONGODB_URI` | Existing Cloudflare secret; retained |
| `CONTEXT_PLANE_API_TOKEN` | Existing Cloudflare secret; retained |

Do not restore the older `context_plane_poc` / `org_demo` /
`project_context_plane` defaults. A successful health check against another scope
would not prove access to the team's shared records.

## Repeat deployment and read checks

From the repository root with dependencies installed, Docker running, and Wrangler
authenticated to the existing account:

```sh
npm run test -w @context-plane/mcp
npm run types -w @context-plane/mcp-worker
npm run typecheck -w @context-plane/mcp-worker
npm run deploy:check -w @context-plane/mcp-worker
npm run deploy -w @context-plane/mcp-worker
```

The Docker build uses an allowlisted build context. Runtime secrets do not enter
the image. Provision or change secrets only through the provider secret store;
never print them or put them in arguments, source, screenshots, or issue comments.
No demo API startup, seed, reset, or synthetic write smoke is required.

With `CONTEXT_PLANE_API_TOKEN` privately injected into the process environment:

```sh
CONTEXT_PLANE_MCP_URL=https://context-plane-brain.buddhsen-work.workers.dev/mcp \
  npm run smoke -w @context-plane/mcp
```

The smoke is read-only unless explicitly given `CONTEXT_PLANE_SMOKE_WRITES=1`.
Do not use synthetic write mode to claim actual teammate onboarding.

For the UI on Vercel, keep the token in a server-side secret environment variable.
Its server-side MCP client calls this HTTPS endpoint and returns appropriate
sanitized state to the browser. Direct browser MCP access is rejected by the
service's Origin check. The local `.env` launcher settings do not automatically
update any teammate's client or Vercel deployment.

## Observed verification

- Before deployment, authenticated remote discovery exposed only the two product
  read tools. After deployment it exposed all nine: `get_project_context`,
  `read_operation`, `register_agent`, `register_dependency`, `get_context`,
  `publish_surface`, `send_message`, `receive_inbox`, and `acknowledge`.
- Live read smoke passed authentication rejection, Atlas readiness, nine-tool
  discovery, scope-override rejection, and two independent HTTP connections.
- Existing `shivraj:primary` and `shivraj:review` work-status surfaces were readable
  through the hosted service. No existing records were reset or seeded.
- Buddhsen's actual development client used its assigned `codex:nyny` identity,
  registered, read context/inbox, published `work-status` and `codex-worklog`, and
  read them back. Coordinator report ID:
  `codex:nyny:6cba0726-c0e0-4f3d-acfc-373fd6b20482`.
- Local MCP tests: 24 passed, one opt-in live Atlas entry skipped. Worker typecheck,
  Linux container build, and Wrangler dry-run passed. The first sandboxed test run
  could not bind loopback ports; the authorized rerun passed.
- `get_project_context` returned a null product projection in this configured
  scope. Coordination surfaces exist independently; do not seed product demo
  state to make that read non-null.

Still pending: Simar's own native client must confirm its endpoint/tools, publish
its actual status, and complete the independent teammate read/message/acknowledge
exchange. No synthetic peer or impersonated teammate was used as evidence.
Issue #3 remains open until those acceptance checks succeed.
