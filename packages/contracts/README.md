# Shared contracts

This package owns the boundary types shared by the Context API, worker, web
application, persistence adapter, registered runner, and deterministic evaluator.

The contracts require organization/project scope, optimistic revisions, durable
event cursors, lease generations, stable operation keys, and the candidate,
dependency, and policy versions used to reject stale changes.

`PersistenceAdapter` is the complete durable boundary. It includes project-scoped
lease capabilities, checkpoint reads, projection compare-and-set writes, and
atomic `commitStep` writes. Candidate-aware steps carry one `ChangeCheckVersion`
through their event, receipt, checkpoint, and projection.

The package also owns the minimal cross-service records for dependency
revisions, staged candidates, check results, publication authorizations, policy
candidates, policy versions, and bounded immutable evidence references.

`src/fixtures/access-run.ts` is the first integration fixture. It demonstrates a
run that blocks for scoped access, resumes after a human decision, and completes
with a receipted protected read. It contains synthetic data only.

Run the checks from the repository root:

```sh
npm test
npm run typecheck
```
