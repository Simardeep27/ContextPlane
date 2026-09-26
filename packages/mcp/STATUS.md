# MCP worker migration — deployment candidate

Branch: `buddhh/mcp-worker`. Based on `wireframe` commit `b7095c8`, which
includes the merged Atlas adapter.

Implemented so far:

- TypeScript MCP HTTP server using the shared contracts and persistence adapter.
- Server-bound project scope, bearer authentication, bounded requests/results,
  and read handlers for `get_project_context` and `read_operation`.
- Configuration to update the existing `context-plane-brain` Cloudflare worker,
  preserving its container class, binding, migration and instance identity.
- Container build files and generated Wrangler binding/runtime types.

Validation:

- MCP and Worker type checks pass.
- MCP HTTP/security integration tests cover bearer authentication, browser
  origin rejection, readiness failures, MCP initialization, tool listing, and
  a context tool call.
- The production Docker image builds through `wrangler deploy --dry-run`.
- `npm run smoke -w @context-plane/mcp` performs authenticated readiness and
  MCP protocol checks against a deployed URL.

Deployment notes:

- `MONGODB_URI` and `CONTEXT_PLANE_API_TOKEN` must be installed as encrypted
  Worker secrets. Never put either value in Wrangler vars or source control.
- Proposed non-secret configuration targets `context_plane_poc`, `org_demo`,
  and `project_context_plane`.
- Client bridge/configuration and teammate onboarding remain unfinished.
- Domain write handlers are not available in the current shared runtime and
  are not exposed. This replaces the old Python tool catalog when deployed.
- No fixture or production data is seeded by this service.

Until the live smoke passes, the existing remote service should be treated as
unchanged. No neighboring source or `.env` is modified or copied by this branch.
