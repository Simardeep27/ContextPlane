# MVP-02: Seed a deterministic Dev A / Dev B dependency scenario

## Goal

Provide a tiny, repeatable fixture that makes the complete demo possible
without relying on real repositories or company data.

## Scope

- Create synthetic Dev A and Dev B identities and personal agents.
- Create two synthetic services with one explicit dependency edge.
- Seed dependency revision `N` and a Dev A candidate based on `N`.
- Provide a deterministic Dev B publication that advances the dependency to
  `N+1` and includes an immutable artifact hash and evidence record.
- Provide the exact combined candidate expected to pass after coordination.
- Provide a small frozen policy-evaluation dataset with unsafe, safe, and
  unrelated outcomes.

## Acceptance criteria

- One command resets and seeds the complete scenario.
- Seed output is stable across runs, including candidate/artifact hashes.
- No credentials, live source code, or real user/company data are included.
- Fixtures cover the stale candidate, corrected combined candidate, and a
  policy case that must not be learned from an unrelated failure.

## Depends on

- MVP-01.
