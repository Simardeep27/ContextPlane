# Local ContextPlane stack

Use Node 24+, Python 3, and the existing MongoDB replica set at
`mongodb://127.0.0.1:27027/?directConnection=true&replicaSet=rs0`.
The launcher checks for a writable `rs0`; it does not provision MongoDB.
It only uses database `context_plane_local`, never Atlas or the team database.

## MongoDB on this Mac

The existing Docker container is `context-plane-hivemind-local`, backed by a
named volume of the same name. To resume it, run
`docker start context-plane-hivemind-local`. To stop it after stopping the
application, run `docker stop context-plane-hivemind-local`; this preserves data.

On a new machine with Docker running and port 27027 free, create it once:

```sh
docker run -d --name context-plane-hivemind-local --label app=context-plane-local \
  -p 127.0.0.1:27027:27017 -v context-plane-hivemind-local:/data/db \
  mongodb/mongodb-community-server:8.0-ubuntu2204 --replSet rs0 --bind_ip_all
docker exec context-plane-hivemind-local mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
```

Wait for `db.hello().isWritablePrimary` to be true. The first command downloads
the official image if needed; the second initializes the new replica set once.
The host port is loopback only. Do not expose this unauthenticated development
database to the network. [MongoDB's Docker guide](https://www.mongodb.com/docs/manual/administration/install-community-docker/)
documents the official image and replica-set arguments.

## Start services

From this repository root:

```sh
npm ci
npm run build
node scripts/local-stack.mjs
```

This starts API `127.0.0.1:3001`, MCP `127.0.0.1:8010`, and the built HQ UI at
[http://127.0.0.1:8787](http://127.0.0.1:8787). Keep the Terminal open.
Ctrl-C stops only the three children started by this launcher. MongoDB remains
running and local data persists. Occupied ports cause startup to fail; unrelated
processes are never killed.

API and MCP use company `org_synthetic_demo` and project `project_mvp_02`.
Coordination tools use scope `project:context-plane`. HQ uses runtime mode and
reads the Context API. It does not play the fictional simulation. The API
initializes its synthetic projection; MCP stores coordination records in the
same local database. The isolated reference gateway is not started or pointed
at this shared project.

## Local token

On macOS the launcher creates a cryptographically random token once and reuses
it from the login Keychain. The service is **ContextPlane Local** and the account
is **context-plane-local-api-token**. Python calls Security.framework directly;
the token never becomes a command argument, source file, environment file, or
log message. macOS may request permission to access the login Keychain.

Initialize it before connecting Codex, without starting services:

```sh
python3 scripts/local-token.py ensure
```

On other platforms, or in a managed environment, provide
`CONTEXT_PLANE_LOCAL_TOKEN` through a secret manager or a hidden Terminal prompt.
It must contain 32–256 URL-safe characters. In Bash or Zsh, the safe paste location
is this hidden prompt:

```sh
read -r -s CONTEXT_PLANE_LOCAL_TOKEN
export CONTEXT_PLANE_LOCAL_TOKEN
```

The prompt does not echo the pasted token. The launcher and MCP client must
inherit the same variable. Never put its value in a command, `.env`, config,
chat, screenshots, or shell history. `CONTEXT_PLANE_API_TOKEN` is deliberately
not an input fallback, so a remote credential cannot silently become the local
credential. The launcher passes the resolved token to its MCP child only.

## Connect Codex

The checked-in `.codex/config.toml` now selects the **team Atlas helper** from
[TEAM_RUN.md](TEAM_RUN.md). To use this isolated local fallback, change its
`http_headers_helper` to `node scripts/context-plane-headers.mjs`, or use the
stdio example below. Do not combine the team helper/token with the local
launcher/token. Start Codex from the repository root after the selected stack
is ready; restart its MCP connection after a config change.
The helper emits headers only to the client's private protocol pipe. Do not run
it by itself or capture its output in a log.

If a desktop client starts helpers from another directory, set an absolute path
for **your checkout**, without adding a token:

```toml
[mcp_servers.context_plane]
url = "http://127.0.0.1:8010/mcp"
http_headers_helper = "node '/absolute/path/to/ContextPlane/scripts/context-plane-headers.mjs'"
startup_timeout_sec = 30
tool_timeout_sec = 120
enabled = true
```

For a client that needs a stdio bridge, replace that entry with:

```toml
[mcp_servers.context_plane]
command = "node"
args = ["/absolute/path/to/ContextPlane/scripts/context-plane-headers.mjs", "--stdio"]
cwd = "/absolute/path/to/ContextPlane"
env_vars = ["CONTEXT_PLANE_LOCAL_TOKEN"]
startup_timeout_sec = 30
tool_timeout_sec = 120
enabled = true
```

The wrapper reads the same Keychain/environment token and connects the existing
bridge exclusively to `http://127.0.0.1:8010/mcp`. Official Codex documentation
describes [HTTP header helpers and stdio configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Verify all nine MCP tools

```sh
node scripts/local-stack.mjs --smoke
```

This starts the stack, checks authentication and scope rejection, then calls
`get_project_context`, `read_operation`, `register_agent`, `register_dependency`,
`get_context`, `publish_surface`, `send_message`, `receive_inbox`, and
`acknowledge`, including reconnect and retry checks. It creates uniquely named
synthetic coordination records only in `context_plane_local`; it does not delete
existing records. A compact PASS report appears when verification succeeds.
Services remain in the foreground until Ctrl-C.

This verifies local connectivity and coordination. It does not establish a
deployed service, individual-agent authorization, completed migration,
model-driven execution, policy improvement, or live Atlas durability.
