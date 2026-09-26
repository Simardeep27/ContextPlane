# ContextPlane

People and their agents do tasks. The company harness shares relevant context,
checks shared actions, records outcomes, and tests improvements to its rules.

## Connect your agent and start sharing context

Current priority: connect the four teammates using the existing system.
New feature work is paused. Replace `NAME` with `shivraj`, `simar`, `buddh` or
`tanish`, then paste this into the agent working on your behalf:

```text
Connect me to the existing ContextPlane system. My identity is NAME:primary.

Pull main without discarding local work:
https://github.com/Simardeep27/ContextPlane

Read AGENTS.md, docs/ONBOARDING.md and docs/AGENT_SYNC_CONTRACT.md.
Use the existing team credentials privately.

1. Connect MCP. Call get_context; reuse my registration if it exists,
   otherwise register_agent with stable metadata. Read receive_inbox.
2. Read the other agents' work-status surfaces before starting shared work.
3. Report meaningful actions through send_message to shivraj:primary,
   using stable event IDs. Publish my task, files, blockers and next action
   as work-status, then read it back to verify synchronization.
4. Reply to shivraj:primary after onboarding and acknowledge its onboarding
   message using the returned lease_generation.
5. Keep following the sync contract while working and before stopping.
   If MCP fails, report unsynchronized state and retain pending reports.

Do not add features, reset data, seed dummy records or start the migration API.
Do not claim connection or synchronization unless the actual calls succeeded.
```

Follow [the connection guide](docs/ONBOARDING.md) and
[the developer agent sync contract](docs/AGENT_SYNC_CONTRACT.md).
All agents use the same Atlas project scope. MCP stores current context and
durable event reports; private local activity is not captured automatically.

## Existing implementation

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
