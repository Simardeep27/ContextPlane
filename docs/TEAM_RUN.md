# Team Atlas runtime

September 26, 2026: user explicitly selected Buddhsen's Atlas and authorized a private ignored `.env` for the hackathon. This supersedes Keychain-only storage for this local setup. Keep `.env` untracked, mode 0600, out of logs and screenshots. Never include it in a commit or deployment image.

From the repository root with Node 24+ and built packages:

```sh
node scripts/team-stack.mjs
```

The launcher reads `.env` privately. Required settings are MONGODB_URI, MONGODB_DATABASE, CONTEXT_PLANE_API_TOKEN, CONTEXT_PLANE_ORG_ID, CONTEXT_PLANE_PROJECT_ID, CONTEXT_PLANE_COORDINATION_SCOPE and CONTEXT_PLANE_MCP_URL. Current nonsecret values:

- Atlas hosts: cluster0-shard-00-00.sx0odb.mongodb.net through cluster0-shard-00-02.sx0odb.mongodb.net; replica set atlas-13shhy-shard-0.
- Existing database: `context_plane`.
- API and MCP scope: `org_synthetic_demo` / `project_mvp_02`.
- Coordination scope: `project:context-plane`.
- API: http://127.0.0.1:3001; MCP: http://127.0.0.1:8010/mcp; HQ: http://127.0.0.1:8787.

Ports must be free. Stop the previous launcher first; this launcher refuses occupied ports and never kills unrelated processes. Ctrl-C stops only its children. The older local-stack launcher still targets Docker and is an explicit fallback, not the active Atlas configuration.

The project MCP config uses `scripts/team-context-plane-headers.mjs` to supply the same token via the private protocol pipe. It also supports `--stdio` for clients needing the existing bridge. Never invoke its header output in a log or Terminal. Existing Codex sessions may need to reconnect/reload MCP configuration. Teammates must use the same database, project and coordination scope to see the same records; credentials are supplied privately, not in this runbook.

Optional provider values in `.env` are injected into backend children only, not HQ browser assets. Supplying an OpenRouter key does not turn the scripted demo into a model-driven worker or change the Codex model.

## Observed validation and writes

- Initial authenticated ping passed in 2011 ms, with zero writes.
- Existing legacy collections: notices, agent_events, decisions, outcomes, edges, messages, surfaces, agents. None were deleted or migrated.
- Normal API/MCP startup created canonical `cp_*` collections/indexes and the missing initial synthetic demo projection. It did not overwrite a preexisting projection. Existing legacy records are not automatically translated into the new runtime's records.
- Read smoke passed Atlas readiness, nine-tool discovery, authentication rejection, scope rejection, reconnect and project projection read. No coordination write smoke or destructive E2E was run on shared Atlas.
- Actual stdio bridge discovered nine tools and read project context successfully.
- Three warm readiness calls returned HTTP 200 in 251, 171 and 266 ms. This is observed response time, not a before/after speedup benchmark.
- OpenRouter key authentication returned HTTP 200; zero inference calls.

No Cloudflare deployment or paid resource provisioning. Running locally keeps the connection pool warm; hosting still needs its own verification. The local API has demo-session authentication and remains loopback-only.
