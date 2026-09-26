# MVP-09: Prove the complete scenario and package demo evidence

## Goal

Create one reproducible command and evidence bundle that proves the lowest-
quality complete demo works from Dev B's publication through Dev A's promoted
personal-agent policy.

## Scope

- Add an end-to-end test that resets and seeds the synthetic scenario.
- Drive Dev B publication, Dev A stale work, the `N+1` pre-publish failure,
  coordinated staging, registered checks, publication, learning, deterministic
  evaluation, promotion, and a held-out follow-up decision.
- Include a deliberate worker restart after a durable side effect.
- Run the scenario against memory storage in CI and Atlas through an explicit
  opt-in command.
- Produce a sanitized manifest of event IDs, candidate/artifact hashes,
  operation receipts, evaluation dataset hash, policy version, and final commit.
- Document a one-minute operator script and known demo limitations.

## Acceptance criteria

- One documented command runs the local scenario from a clean seed.
- Assertions prove the stale candidate was never published and the tested hash
  equals the published hash.
- Assertions prove the restart did not duplicate the side effect.
- Assertions prove only the passing policy candidate became Dev A's next policy.
- `npm test`, `npm run typecheck`, and `npm run build` pass from the root.
- The evidence manifest contains no credentials or hidden reasoning.

## Depends on

- MVP-01 through MVP-08.
