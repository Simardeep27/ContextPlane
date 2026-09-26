# MCP worker migration status

Deployed on 2026-09-26 from branch `buddhh/mcp-worker`.
Worker version: `e1431d29-18be-44b1-91fa-31a9bc638967`.
The existing worker/container application now runs the TypeScript MCP server
against shared contracts and the Atlas persistence adapter.

Validated:
- Workspace build and typecheck; 5 contract and 17 persistence tests.
- All 11 MCP HTTP/stdio tests, including authentication and scope isolation.
- Linux container build and Wrangler deployment dry-run.
- Live authenticated Atlas readiness, both read tools, scope rejection, and reconnects.
- Stdio bridge discovery and read against the deployed service.

The configured scope has no saved projection: the live read returned `null`.
No data was seeded or migrated. No neighboring source or env file was changed.
The local Codex `context_plane` entry references the existing neighboring env
file and built bridge, with 120-second startup/tool timeouts. Restart the client
session to load it; a full Codex/Claude workflow has not been validated.

Only `get_project_context` and `read_operation` are exposed. Domain writes and
per-agent authorization remain pending the shared runtime. The shared token
permits project reads; it does not identify individual agents. See [README](README.md)
for teammate setup, configuration, and operational constraints.
