# MVP-03: Build scoped context and publish-ingestion API

## Goal

Record Dev B's publication and give Dev A's agent only the scoped, versioned
context needed for its task.

## Scope

- Add a minimal API application with fixed demo authentication.
- Accept the synthetic Dev B publication as a command with an idempotency key.
- Persist its dependency revision, artifact hash, event, and evidence pointer.
- Implement `get_project_context` for the current agent and project.
- Return the dependency revision, policy epoch, addressed messages, allowed
  tools, and evidence references used to construct the context.
- Expose read endpoints for the current projection and event timeline.

## Acceptance criteria

- Replaying the same publication command is a no-op; conflicting reuse fails.
- Dev A receives revision `N` before publication and `N+1` afterward.
- A cross-project or wrong-agent context request is rejected.
- The response contains evidence IDs rather than unbounded evidence bodies.
- API integration tests run against `MemoryStorage`; one opt-in Atlas test proves
  the same publication survives a new connection.

## Depends on

- MVP-01 and MVP-02.
