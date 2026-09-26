# MCP worker migration — work in progress

Checkpoint requested before implementation was finished. Branch: `buddhh/mcp-worker`.
Based on `wireframe` commit `b7095c8`, which includes the merged Atlas adapter.

Implemented so far:

- TypeScript MCP HTTP server using the shared contracts and persistence adapter.
- Server-bound project scope, bearer authentication, bounded requests/results,
  and read handlers for `get_project_context` and `read_operation`.
- Configuration to update the existing `context-plane-brain` Cloudflare worker,
  preserving its container class, binding, migration and instance identity.
- Container build files and generated Wrangler binding/runtime types.

Validation and blockers:

- Dependencies installed; Wrangler type generation passed.
- Build currently fails in `src/app.ts`: MCP SDK transport types conflict with
  this package's `exactOptionalPropertyTypes` setting (transport options and
  `onclose`). This checkpoint is not build-ready.
- MCP HTTP/security tests, container build, deploy dry-run, and live checks
  have not been completed. No test files exist in this package yet.
- The package's `smoke` script is reserved; `src/smoke.ts` is not implemented.
- Client bridge/configuration and teammate onboarding remain unfinished.
- Domain write handlers are not available in the current shared runtime and
  are not exposed. This replaces the old Python tool catalog when deployed.
- Proposed configuration targets `context_plane_poc`, `org_demo`, and
  `project_context_plane`; no fixture or production data was seeded.

**No deployment has occurred.** The existing remote Python MCP service and its
encrypted secrets remain unchanged. No neighboring source or `.env` was modified
or copied. Resolve the build and complete the above checks before deployment.
