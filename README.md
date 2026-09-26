# ContextPlane

People and their agents do tasks. The company harness shares relevant context,
checks shared actions, records outcomes, and tests improvements to its rules.

The current baseline includes a scoped context API, nine coordination MCP tools,
a runtime-connected HQ view, and an isolated Orders/Billing reference that
executes real checks and recovers a publication after a process crash.
MVP-01 through MVP-03 are implemented foundations. MVP-04 through MVP-09
remain partial; see [the handoff](docs/HANDOFF.md) for the exact integration gaps.

With Node 24 (verified), or Node 22.12+ and npm:

```sh
npm ci
npm test
npm run typecheck
```

- [Run against the team's selected Atlas database](docs/TEAM_RUN.md), the current MCP configuration.
- [Run an isolated local MongoDB/API/MCP/HQ stack](docs/LOCAL_RUN.md), with its separate client configuration.
- [Run the isolated migration and crash-recovery proof](docs/E2E_RUNBOOK.md).
- [Understand the units, authority and stores](docs/ONTOLOGY.md).
- [Read the implemented domain/data model](docs/DOMAIN_MODEL.md).
- [Connect a client through MCP](packages/mcp/README.md).
- [Continue MVP-04 onward](docs/HANDOFF.md).

HQ reads the MVP-03 API by default. Its optional simulation is visibly labelled.
The reference gateway uses a separate project and is not yet the shared API's
writer. The MCP token currently authorizes a trusted team project; declared
agent names are not individual authentication. No company productivity uplift
or completed autonomous company workflow is claimed.
