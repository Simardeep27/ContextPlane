# Connect the four teammates now

Current objective: use the existing system to share actual work context.
Feature development and the remaining MVPs are paused. No dummy seed/reset runs.

| Person | First agent identity |
| --- | --- |
| Shivraj | `shivraj:primary` |
| Simar | `simar:primary` |
| Buddh | `buddh:primary` |
| Tanish | `tanish:primary` |

The coordinator registered these names. Only a publication from the person's
own connected client proves that they are onboarded. A second agent uses a
different suffix, such as `simar:review`; never share one identity concurrently.

## Give this instruction to your coding agent

> Pull ContextPlane main without discarding local work. Read AGENTS.md and
> docs/ONBOARDING.md and docs/AGENT_SYNC_CONTRACT.md. Stop adding features. My identity is YOUR_NAME:primary.
> Connect to the existing coordination MCP using the team's privately supplied
> .env. Call get_context first; reuse an existing registration, otherwise call
> register_agent with stable metadata. Read receive_inbox. Publish my real task,
> files/resources, blockers, next action and timestamp as a work-status surface.
> Read the other agents' surfaces and summarize what they are doing. Reply to
> shivraj:primary through send_message, then acknowledge the onboarding message
> using its lease_generation. Follow the sync contract to report meaningful
> actions and keep current state synchronized. Report failures honestly.

Replace YOUR_NAME with `shivraj`, `simar`, `buddh` or `tanish`.

## Use one database and scope

Use the existing team credentials privately. Do not paste them into issues.
The ignored `.env` must have the same nonsecret settings on every laptop:

```dotenv
MONGODB_DATABASE=context_plane
CONTEXT_PLANE_ORG_ID=org_synthetic_demo
CONTEXT_PLANE_PROJECT_ID=project_mvp_02
CONTEXT_PLANE_COORDINATION_SCOPE=project:context-plane
CONTEXT_PLANE_MCP_URL=http://127.0.0.1:8010/mcp
```

Keep the established scope strings even though their names contain “demo”.
Renaming them would create disconnected groups. MONGODB_URI and
CONTEXT_PLANE_API_TOKEN are provided privately in the same ignored `.env`.

On each teammate's laptop, use Node 24. If dependencies/builds are missing:

```sh
npm ci
npm run build
```

If that laptop does not already have the current MCP server on port 8010:

```sh
node --env-file=.env packages/mcp/dist/main.js
```

Keep that terminal open. **Start only MCP for onboarding.** Starting the API or
team-stack initializes the synthetic migration projection again. Do not launch
the old Cloudflare endpoint or an old branch with different storage collections.

For either Codex or Claude, add a stdio MCP server with:

- Command: the absolute path to your Node 24 executable.
- Arguments: `/absolute/path/to/ContextPlane/scripts/team-context-plane-headers.mjs`, `--stdio`.

The wrapper connects to that laptop's MCP server; all laptops use the same
Atlas database. Restart/reconnect the client's MCP connection after configuring
it. The checked-in HTTP configuration also works when its helper runs from the
repository root. Do not copy another person's laptop paths.

## Publish and read real context

Every coordination call uses `scope: "project:context-plane"` and your identity.
First call get_context. The four primary identities are already registered:
reuse them. Only call register_agent if context is null; existing registrations
reject different metadata, including an empty default. Then follow
[the sync contract](AGENT_SYNC_CONTRACT.md) to record a work_started report and
call publish_surface with your real state. A minimal onboarding example is:

```json
{
  "identity": "YOUR_NAME:primary",
  "scope": "project:context-plane",
  "surface_name": "work-status",
  "kind": "team-context",
  "content": {
    "currentTask": "What I am actually doing",
    "files": [],
    "completed": [],
    "blockedOn": [],
    "nextAction": "One concrete next action",
    "updatedAt": "Actual current timestamp"
  }
}
```

get_context returns the current shared surfaces, including other people.
Read it before acting and after important handoffs. Publish after meaningful
changes or when blocked. These are agent reports, not automatically captured
private chats, shell activity or verified completion receipts.

receive_inbox leases messages. Acknowledge only after performing the requested
work, with the returned lease_generation. Use a stable message_id when retrying
send_message. The existing project token is a trusted-team credential, not
individual identity authentication.

## Coordinator acceptance

Each person must publish from their own client, read another person's current
surface, and reply to `shivraj:primary`. Persisted registrations alone do not
count. The coordinator reports progress in chat; the existing HQ migration UI
does not display these coordination surfaces.

On September 26 the coordinator backed up and cleared 418 dummy records in
`context_plane`, retaining all collections and indexes. The backup stays private
and ignored. New records must represent actual onboarding/work only.
