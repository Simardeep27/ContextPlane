# MCP observability in LangSmith

The hosted MCP exports metadata-only request and tool traces to
[context-plane-mcp in LangSmith](https://smith.langchain.com/o/ea5b2415-5eae-4655-8f96-99f8c1ca310a/projects/p/4d451bc7-55af-4783-b54a-3318670ec4bd).
Sign in with access to the team's LangSmith workspace.

## What to inspect

- `mcp.request.tools/list`: native MCP discovery.
- `mcp.request.tools/call`: request parent; expand its `mcp.tool.*` child.
- Child error: sanitized domain error such as `INVALID_INPUT` or
  `SERVICE_UNAVAILABLE`. A tool failure can still have HTTP status 200.
- `duration_ms`, HTTP status, project scope, and `declaredAgent` metadata.
  Known team identities are labels; other identity values are hashed. These
  caller declarations do not establish individual authentication.
- `mcp.readiness`: authenticated Atlas readiness requests.

Each container response includes `X-Context-Plane-Trace-Id`. Authenticated
`/readyz` also returns a `tracing` object: `enabled`, `project`, `pending`,
`succeeded`, `failed`, `dropped`, and `lastErrorStatus`. Counters are local to the
container process and reset on restart. A succeeded counter means LangSmith
accepted the export; reading a run back separately verifies its persistence.

Inputs are empty; outputs contain only success/error status. Message contents,
raw tool arguments/results, HTTP headers, tokens, connection strings and raw
exception messages are excluded. Edge authentication/Origin rejections occur
before this container and remain in Cloudflare observability.

Tracing is best-effort: maximum 32 pending exports, three-second request timeout,
no retries, and shutdown drain within the existing five-second grace period.
Provider failures log `langsmith_export_failed` with a safe status code; overload
logs `langsmith_trace_dropped`. MCP operations continue if tracing is unavailable.
Atlas remains the authoritative coordination store.

## Configuration

The Worker forwards its secret `LANGSMITH_API_KEY` into the existing container.
Nonsecret settings are `LANGSMITH_TRACING=true` and
`LANGSMITH_PROJECT=context-plane-mcp`. The exporter targets the US API at
`https://api.smith.langchain.com`. Set tracing to `false` to disable exports.
Update credentials only via the provider secret store, never in source or logs.
The private locally verified key was installed in the Worker during this rollout.

## Verified deployment — September 26, 2026

- Source commit: `5eeb54d` (instrumentation plus tracing health counters).
- Worker version: `ec81b9ac-bf74-4c62-84d3-51374fd23d3f`.
- Container digest: `sha256:faeef4909e65c7230853300d7c379ef1f7027382ea45b916454dd65924534181`.
- MCP endpoint: `https://context-plane-brain.buddhsen-work.workers.dev/mcp`.
- Existing Atlas database/scope and nine tools preserved.
- 27 MCP tests passed; one opt-in live Atlas test skipped. MCP/Worker typechecks
  and Linux image build passed. Tests cover privacy, provider failure isolation,
  bounded exports, request/tool relationships and domain errors.
- Read back these exact deployed-request traces from LangSmith at 20:23 UTC:

| Check | Trace ID | Result |
| --- | --- | --- |
| Discovery | `6883deec-aa33-4465-82eb-3ecec2f6e1eb` | `mcp.request.tools/list` |
| Context read | `09be6450-1ae6-4c7e-9cb4-f425eda2e762` | Successful `mcp.tool.get_context` child |
| Invalid-input probe | `ed3a93f6-21b0-40f8-a400-df01471a840d` | Child recorded `INVALID_INPUT` |

The last observed readiness snapshot had 212 successful exports, zero failed,
zero dropped, and no pending exports. These are observations, not cumulative
uptime guarantees. Earlier probe IDs from the first rollout were not found;
only the verified rollout above is counted as live tracing evidence.

Reference: [LangSmith manual instrumentation](https://docs.langchain.com/langsmith/trace-with-api).
