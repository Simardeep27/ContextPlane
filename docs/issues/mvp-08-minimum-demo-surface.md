# MVP-08: Add the minimum observable demo surface

## Goal

Make the pipeline understandable in one short demonstration without building a
general product UI.

## Scope

- Add one project page for the synthetic scenario.
- Show the current dependency revision, Dev A candidate version, active policy
  epoch, run status, and blocker.
- Show a chronological evidence timeline for publication, stale detection,
  staging, checks, authorization, outcome learning, evaluation, and promotion.
- Provide fixed controls to trigger the next scripted demo action.
- Link summaries to sanitized receipt/evidence detail.

## Acceptance criteria

- A viewer can distinguish revision `N` from `N+1` and see why the first
  publication was blocked.
- The displayed candidate hash matches the staged, tested, and published hash.
- The policy view shows candidate, evaluation result, approved version, and
  Dev A as its target.
- Refreshing the page reconstructs the same state from persisted data.
- No secret, hidden reasoning, raw prompt, or private connection information is
  rendered.

## Depends on

- MVP-03 through MVP-07.
