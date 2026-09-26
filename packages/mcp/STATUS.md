# MCP integration status — 2026-09-26

LangSmith tracing is deployed from `5eeb54d`, Worker version
`ec81b9ac-bf74-4c62-84d3-51374fd23d3f`. Exact live request/tool success and error
traces were read back from LangSmith. The expanded MCP suite has 27 passing tests
and one opt-in Atlas skip. See [observability evidence](../../docs/MCP_OBSERVABILITY.md).

Initial nine-tool hosting deployment: source `73a9106`, Worker version
`bdff3753-2963-41a7-a50e-b67787c35c7d`. Authenticated discovery exposes all nine
tools against the existing team scope. Existing teammate surfaces and our own
publication/readback are verified; independent teammate message acceptance is
still pending. See [hosted verification](../../docs/MCP_HOSTING.md).

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
not implemented. The initial reconciliation did not deploy this source; the subsequent issue #3
deployment and live verification are recorded above. See
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
