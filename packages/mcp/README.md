# ContextPlane MCP

Streamable HTTP MCP with a stdio client bridge. The configured worker endpoint is
`https://context-plane-brain.buddhsen-work.workers.dev/mcp`. Source capability and
live deployment status are recorded separately in [STATUS.md](STATUS.md).

## Current capabilities

- `get_project_context`: returns the stored project projection, or `null` if none exists.
- `read_operation`: reads a scoped operation receipt by `operationKey`.
- `register_agent`, `register_dependency`, `get_context`, `publish_surface`,
  `send_message`, `receive_inbox`, `acknowledge`: persist project coordination.

Product read schemas come from `@context-plane/contracts`; reads use
`@context-plane/persistence`. Coordination uses separate `cp_coordination_*`
collections with scoped keys, optimistic revisions, message idempotency, and
expiring inbox leases. An acknowledgement needs the current lease generation;
identical retries return the recorded outcome. Failed acknowledgements return
messages to the queue. Lease expiry makes unfinished messages eligible again.

The bearer token authorizes one **trusted project team**. Coordination identity
is caller-selected: any token holder can act as any identity in that project,
including leasing its inbox. Agent registration does not authenticate ownership.
Do not distribute this token across trust boundaries. Server configuration fixes
organization, project, and coordination scope; callers cannot override them.
Worker defaults are `org_synthetic_demo` / `project_mvp_02`, coordination scope
`project:context-plane`, database `context_plane`.

No fixtures are inserted at startup. Coordination writes do not execute or
authorize the gateway's check/apply commands or update its event ledger. The API
demo uses a different project scope. Per-agent authorization, automatic activity
capture, and complete Codex/Claude workflows remain pending.
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
```

For local startup, inject `MONGODB_URI` and a `CONTEXT_PLANE_API_TOKEN` of at least
16 characters through the existing runtime secret mechanism. Do not put secret
values in command arguments, source, logs, or chat. Use an isolated Mongo database:

```sh
HOST=127.0.0.1 PORT=8010 MONGODB_DATABASE=cp_mcp_local_testing \
CONTEXT_PLANE_ORG_ID=org_local CONTEXT_PLANE_PROJECT_ID=project_local \
CONTEXT_PLANE_COORDINATION_SCOPE=project:context-plane \
npm start -w @context-plane/mcp
```

The smoke client needs the same injected token. It checks readiness, exactly
nine tools, product reads, coordination scope rejection, and two HTTP connections:

```sh
CONTEXT_PLANE_MCP_URL=http://127.0.0.1:8010/mcp \
node packages/mcp/dist/smoke.js
```

This default smoke writes no records. To verify all seven coordination actions,
set `CONTEXT_PLANE_SMOKE_WRITES=1` as well. Write mode creates UUID-named synthetic
agents, dependency, surface, and message records in the configured database; it
checks send/ack replay and retained context after reconnect. It leaves those
records for inspection. Set `CONTEXT_PLANE_COORDINATION_SCOPE` if using a custom
scope. `MCP_BASE_URL` remains supported as a smoke-only endpoint alias.

Normal tests use an in-memory repository, real loopback HTTP, and restarted stdio
bridges, plus simulated Mongo write races. The opt-in Mongo suite requires
`CONTEXT_PLANE_ATLAS_TESTS=1` and an injected URI; it creates and removes only a
unique `cp_coordination_test_<UUID>` database. It also works against an isolated
local Mongo server. Local tests require permission to listen on loopback.
The MCP package disables `exactOptionalPropertyTypes` to accommodate SDK v1
transport callback types; other strict TypeScript checks remain enabled.

## Deployment and operations

`packages/mcp-worker/wrangler.jsonc` preserves worker `context-plane-brain`,
`BrainContainer`, binding `BRAIN`, migration `v1`, and named instance `iteration-0`.
There is one lite container; it sleeps after ten minutes. Secrets `MONGODB_URI`
and `CONTEXT_PLANE_API_TOKEN` already exist on the worker and are forwarded at
runtime. The existing LangSmith secret is forwarded to the container for metadata-only tracing.
The image allowlist excludes env files and neighboring source.

```sh
npm run deploy -w @context-plane/mcp-worker
```

This deploys with `--keep-vars`; declared database/scope vars are updated.
Authenticated `/readyz` pings Mongo and initializes coordination indexes. MCP
initialization and tool listing can succeed while Mongo is unavailable; data
operations then return sanitized errors. Requests/results
are bounded, browser Origins rejected, and bearer comparison uses constant-time
comparison. The service creates coordination indexes; it does not modify Atlas
users or network rules. Context reads return at most 100 dependencies/surfaces
and fail closed if their serialized result exceeds the response budget. Inbox
batches are bounded before return; remaining messages stay retryable.
Atlas access-list expiry can affect later readiness even after a successful deploy.

Before rollback, inspect both the Worker version and container application image:
a Worker version rollback alone should not be assumed to restore the old image.
Previous Python Worker version: `8d9f951a-02c3-408b-9e73-7ae742aa6217`.
Previous image digest: `sha256:30199602520f43b5fadcdb72483c2f7fb70ef28d94babbd11fadb6198ef45d98`.

References: [Cloudflare Containers](https://developers.cloudflare.com/containers/),
[runtime secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/),
[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), and
[Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## LangSmith visibility

[Open the dashboard and verified deployment record](../../docs/MCP_OBSERVABILITY.md).
Authenticated `/readyz` includes tracing enablement, pending/succeeded/failed/dropped
export counters and the last safe HTTP error status. Counters reset on restart.

The hosted container exports completed MCP request and tool spans to the
`context-plane-mcp` LangSmith project. Enable with `LANGSMITH_TRACING=true`,
`LANGSMITH_PROJECT=context-plane-mcp`, and the provider-managed
`LANGSMITH_API_KEY`. The current exporter targets the US LangSmith API.

Request traces cover initialization, discovery, calls, and authenticated readiness.
Tool children record the fixed tool name, duration, outcome, sanitized error code,
server-side project scope, and a declared agent label (known team names or a hash).
The response header `X-Context-Plane-Trace-Id` identifies the request trace. A tool
error can accompany HTTP 200; inspect its child span for the domain error code.
No raw arguments, results, message bodies, headers, tokens, or connection strings
are exported. Agent labels are caller-declared, not authentication evidence.

Exports run in the background with a 3-second timeout, no retries, and at most
32 pending exports. Failures log `langsmith_export_failed`; capacity drops log
`langsmith_trace_dropped`. Neither makes an MCP operation fail. Shutdown drains
pending exports within the existing five-second process grace period. This is
best-effort observability, not an authoritative ledger; hard crashes or provider
outages can lose traces. Cloudflare edge rejections occur before the container
and are visible in Cloudflare observability, not these LangSmith traces.

Filter runs by `mcp.tool.get_context`, `mcp.tool.publish_surface`, or
`mcp.request.tools/list`; inspect error spans to diagnose failed calls.
[LangSmith instrumentation reference](https://docs.langchain.com/langsmith/trace-with-api).
