# Context API — MVP-03

This application exposes the minimum scoped API for the synthetic Dev A / Dev B
scenario. Authentication is intentionally fixed: send `x-demo-session: dev-a`
or `x-demo-session: dev-b`. The server derives organization, project, user,
agent, and role from that session; callers cannot choose their own scope.
This is a separate local demo API, not the MCP or gateway write path. It listens
only on `127.0.0.1`; the public demo session names are not production credentials.

Routes:

- `POST /v1/projects/:projectId/publications/dev-b`
- `GET /v1/projects/:projectId/context`
- `GET /v1/projects/:projectId/projection`
- `GET /v1/projects/:projectId/events?after=000000`

Run local tests from the repository root with `npm test`. The normal suite uses
`MemoryStorage`. The opt-in Atlas recovery test creates and removes only an
isolated `cp_api_test_<UUID>` database:

```sh
CONTEXT_PLANE_ATLAS_TESTS=1 npm run test:atlas -w @context-plane/api
```

Start the API with a runtime-injected `MONGODB_URI`:

```sh
npm start -w @context-plane/api
```
