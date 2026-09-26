# Consolidation verification

Observed September 26, 2026 on macOS, Node 24, MongoDB 8.0 in Docker with a
loopback-only `rs0` replica set. This record covers the consolidated source
after importing Simardeep's MCP tools and Tanish's HQ work, including review fixes.
It is not a hosted Atlas or Cloudflare verification.

| Check | Result |
| --- | --- |
| Full workspace build | Pass, including HQ production bundle |
| Full workspace typecheck | Pass, including MCP worker adapter |
| Default package tests | 98 passed, 0 failed; one opt-in Mongo test entry skipped |
| Default file-backed process E2E | Pass: 8 rejection cases, 2 publications, exact code hash, actual SIGKILL/restart |
| Actual local Mongo persistence tests | 20 passed, including transactions, lease fencing, unique indexes and reconnect |
| Actual local Mongo context API test | 1 passed, reconnect retained publication/context |
| Actual local Mongo MCP tests | 3 passed, reconnect, competing retries, expired leases and surface/project isolation |
| Mongo-backed process E2E | Pass: 8 rejection cases, 2 publications, no duplicate publication, exact code hash |
| Running HTTP MCP smoke | All 9 tools; authentication/scope rejection, writes, retries and reconnect passed; projection present |
| Local stdio bridge | All 9 tools discovered; agent registration/worklog persisted across bridge restart; API projection revision 8 read through MCP |
| API to HQ | Local fixture publication 7 to 8 returned 201; retry returned 200 and replayed; one event; HQ showed revision 8 after browser refresh |

The local Mongo runs used the existing opt-in test files named `atlas.test.ts`;
their historical test names do not turn a local run into Atlas evidence.
Temporary test databases were cleaned up. The runnable local database and
reference E2E evidence are retained, with separate fixed database boundaries.

Local evidence paths under the checkout (ignored, not committed):

- `.artifacts/consolidation-tests.log` and `.artifacts/consolidation-types.log`.
- `.artifacts/local-mongo-adapters.log`.
- `.artifacts/local-api-hq-smoke.json`.
- `.artifacts/local-stdio-smoke.json`: an MCP SDK client, not a native
  Codex or Claude session. Reload the project's MCP connection to use it there.
- `.artifacts/e2e/fc4b65e8554e43b3a3d0a48ad02f1169/manifest.json`: actual local
  Mongo process restart, accurately marked as a dirty integration tree based on
  `d27b038`. An intentionally invalid `MONGODB_URI` was ignored by `--mongo-local`.

The local launcher creates/reuses a separate random token in macOS Keychain.
No token or connection credential was placed in source or test output.
The initial sandboxed Keychain creation failed; creation succeeded with the
authorized system Keychain access, and subsequent local startup succeeded.

All tests use controlled fixtures. Learned and equivalent static rules both
score 5/5; zero model calls and no measured productivity uplift. The HQ adapter
shows stored context-API evidence, not reference-gateway execution. See
[HANDOFF.md](HANDOFF.md) for remaining MVP acceptance work.
