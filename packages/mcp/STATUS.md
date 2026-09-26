# MCP integration status — 2026-09-26

Current merged source exposes nine tools: two product reads and seven durable
coordination tools. The HTTP server and stdio bridge are reconciled. Local
validation: typecheck passes; 24 tests pass and one opt-in Mongo test entry is
skipped without an explicit test URI/flag. The local suite exercises all nine
tools, reconnects, a restarted bridge, message retries, lease expiry/generations,
scope isolation, bounded inbox responses, and simulated Mongo write conflicts.

Critical integration fixes preserve dependency ownership, reject lost updates,
separate colon-containing surface keys while retaining matching legacy records,
reconcile concurrent message retries, reject expired leases, and retry failed
index initialization. Repeated acknowledgements preserve the recorded outcome.

The shared token grants project-wide coordination access with caller-selected
identities. Per-agent authentication and the product gateway write adapter are
not implemented. This source merge has not been deployed or independently
verified against the hosted endpoint in this reconciliation task. See
[README](README.md) for safe local startup and explicit smoke write mode.

## Earlier deployment evidence retained from b016cf8

The earlier branch recorded deployment on 2026-09-26 from `buddhh/mcp-worker`.
Worker version: `e1431d29-18be-44b1-91fa-31a9bc638967`.
That record describes the two-read-tool TypeScript server against shared
contracts and the Atlas persistence adapter, not proof of the current nine-tool
source being deployed.

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

Only `get_project_context` and `read_operation` were exposed in that historical
record. Its version and validation do not establish current hosted capability.
