# MVP-07: Learn, evaluate, and promote a personal-agent policy

## Goal

Turn the verified stale-dependency outcome into a narrowly scoped candidate
improvement, and promote it only after deterministic validation.

## Scope

- Define a restricted, non-executable policy rule for dependency coordination.
- Generate a candidate rule from the verified outcome and its causal evidence.
- Evaluate it against the frozen dataset from MVP-02.
- Require all unsafe cases to be caught and zero valid cases to be blocked.
- Store dataset hash, candidate policy hash, counts, provenance, evidence IDs,
  and the target personal-agent identity.
- Promote an immutable policy version and increment the policy epoch only after
  evaluation passes.
- Include the promoted version in Dev A's next context packet.

## Acceptance criteria

- Unrelated failures do not produce a promotable lesson.
- A rule that blocks the valid coordinated change fails evaluation.
- A passing rule produces one immutable version targeted to Dev A's agent.
- The next context request contains the new policy version/epoch and causes the
  held-out related change to request coordination before staging.
- Promotion is idempotent and fully traceable to evidence.

## Depends on

- MVP-01, MVP-04, and MVP-05.
