# ContextPlane MCP

Streamable HTTP MCP at `https://context-plane-brain.buddhsen-work.workers.dev/mcp`.
This replaces the neighboring Python server on the existing worker. Old Python
tool names are no longer exposed. The existing Atlas data is not migrated or deleted.

## Current capabilities

- `get_project_context`: returns the stored project projection, or `null` if none exists.
- `read_operation`: reads a scoped operation receipt by `operationKey`.

Schemas come from `@context-plane/contracts`; reads use `@context-plane/persistence`.
The bearer token represents one shared project reader, not an individual agent.
The server fixes scope to `org_demo` / `project_context_plane` in database
`context_plane_poc`. Callers cannot select another scope or identity.
No fixtures are inserted at startup. Write handlers, per-agent authorization,
automatic activity capture, and complete Codex/Claude workflows remain pending.
Add implemented handlers through the domain registry and principal allowlist;
registering a schema alone does not expose a working tool.

## Connect a teammate

A client only needs the endpoint and `CONTEXT_PLANE_API_TOKEN`, delivered through
a private channel. It does not need the MongoDB URI or Atlas account access.
For Codex launched with that token in its environment:

```sh
codex mcp add context_plane \
  --url https://context-plane-brain.buddhsen-work.workers.dev/mcp \
  --bearer-token-env-var CONTEXT_PLANE_API_TOKEN
```

For desktop clients that do not inherit shell environment variables, build the
bridge and use an existing private env file containing `CONTEXT_PLANE_API_TOKEN`:

```sh
npm ci
npm run build
codex mcp add context_plane -- /absolute/path/to/node \
  --env-file=/absolute/path/to/private.env \
  /absolute/path/to/ContextPlane/packages/mcp/dist/bridge.js
```

Set `startup_timeout_sec = 120` and `tool_timeout_sec = 120` in the
`[mcp_servers.context_plane]` section of the client configuration for cold starts.
Restart the client/session after adding it. Never commit the env file or token.
The endpoint defaults to the hosted worker; `CONTEXT_PLANE_MCP_URL` can override
it with HTTPS (HTTP is restricted to loopback). The bridge writes only MCP to stdout.

## Development and verification

Node 22+, npm workspaces, and Docker are required for deployment.

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run deploy:check -w @context-plane/mcp-worker
node --env-file=/absolute/path/to/private.env packages/mcp/dist/smoke.js
```

The HTTP tests use an in-memory repository and a real loopback MCP connection,
including the stdio bridge. The hosted smoke test checks authentication, Atlas
readiness, tool discovery, both reads, reconnects, and scope-override rejection.
It writes no records. Local tests require permission to listen on loopback.
The MCP package disables `exactOptionalPropertyTypes` to accommodate SDK v1
transport callback types; other strict TypeScript checks remain enabled.

## Deployment and operations

`packages/mcp-worker/wrangler.jsonc` preserves worker `context-plane-brain`,
`BrainContainer`, binding `BRAIN`, migration `v1`, and named instance `iteration-0`.
There is one lite container; it sleeps after ten minutes. Secrets `MONGODB_URI`
and `CONTEXT_PLANE_API_TOKEN` already exist on the worker and are forwarded at
runtime. The unused existing LangSmith secret is retained but not forwarded.
The image allowlist excludes env files and neighboring source.

```sh
npm run deploy -w @context-plane/mcp-worker
```

This deploys with `--keep-vars`; declared database/scope vars are updated.
Authenticated `/readyz` pings Atlas. Initialization and tool listing can succeed
while Atlas is unavailable; reads then return sanitized errors. Requests/results
are bounded, browser Origins rejected, and bearer comparison uses constant-time
comparison. The service does not modify Atlas users, indexes, or network rules.
Atlas access-list expiry can affect later readiness even after a successful deploy.

Before rollback, inspect both the Worker version and container application image:
a Worker version rollback alone should not be assumed to restore the old image.
Previous Python Worker version: `8d9f951a-02c3-408b-9e73-7ae742aa6217`.
Previous image digest: `sha256:30199602520f43b5fadcdb72483c2f7fb70ef28d94babbd11fadb6198ef45d98`.

References: [Cloudflare Containers](https://developers.cloudflare.com/containers/),
[runtime secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/),
[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), and
[Codex MCP configuration](https://developers.openai.com/codex/mcp/).
