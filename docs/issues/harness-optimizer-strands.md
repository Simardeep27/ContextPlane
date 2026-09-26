# Proposal: Strands Harness Optimizer as the improvement job's proposer

Status: **spec only, not claimed, not implemented.** Written September 26, 2026
after MVP-06 (#16) and MVP-07 (#17) merged. Nothing here has been run.
Statements about the Strands libraries come from their public README/blog and
are not verified in this repository.

## Goal

Use the open-source Strands Harness Optimizer to propose better instructions for
the company worker from its recorded runs. The Company Harness keeps the
authority it has today: a fixed verifier scores the proposal, and the activation
controller adopts it. Strands suggests; the harness decides.

## Where it fits (ONTOLOGY.md §4)

| Responsibility | Role in this proposal |
| --- | --- |
| **Harness improvement job** ("optimizer") | **Gains a second proposer backend**, `strands-contrastive-reflection`, next to today's `deterministic-rule-derivation`. It may only submit a proposal. |
| **Verifier** (#5) | Unchanged authority. Scores rollouts and evaluates the candidate with fixed checks. The optimizer never supplies or edits these checks. |
| **Activation controller** (#4) | Unchanged. Activates only a passing, exactly bound evaluation and increments `policyEpoch`. |
| **Context steward** | Delivers the active instructions in the worker's next context packet, like `agentContext.activePolicy` today. |

It is **not** a new evaluator and **not** an observer agent. Putting it in the
verifier would let the learner influence its own definition of success, which
§5 forbids.

## Why today's rule is not the right target

`CoordinationRule` (`packages/core/src/coordination.ts`) is deliberately tiny.
Its only free field is `requiredAgentIds`. A reflection optimizer has almost
nothing to search there. The real tunable context is the worker's system prompt
(`packages/gateway/src/openrouter.ts`, the `role: 'system'` message), which
matches the optimizer's `SystemPromptFormula`.

**Ontology gap:** worker instructions are not one of the four rule families in
§5. Before implementation, open a #9 decision to add a **worker-instructions**
family: versioned text, proposed by the improvement job, evaluated by the fixed
verifier, and never able to change tools, grants, budgets or acceptance.

## Design

```text
recorded MVP-06 runs (ledger events: request, inference, tool outcomes, receipts)
  -> verifier scores each run from receipts (reward)
  -> Strands optimizer: add_rollouts / add_rewards / step on SystemPromptFormula
  -> candidate instructions (text + hash)
  -> policy_proposed   (proposalMode: strands-contrastive-reflection)
  -> policy_evaluated  (fixed verifier: fresh held-out runs, candidate vs active)
  -> policy_activated  (controller; epoch + 1)
  -> next worker context packet carries the active instructions
```

1. **Rollouts come from our ledger, offline.** MVP-06 already persists each
   model turn's `InferenceRequest`, `InferenceResult` and tool outcomes as
   ledger events (`harness.ts`, `modelTurn`). A Python adapter converts one run
   into the optimizer's rollout dictionary. We do not rewrite the worker as a
   Strands `Agent`. The formula is only a parameter holder.
2. **Rewards come from receipts, not model self-reports.** A run earns reward
   for reaching the stale-revision blocker, publishing the exact corrected
   candidate, and never publishing a stale one. It is penalized for a rejected
   out-of-allowlist tool call, a duplicate effect, and excess model calls. All of
   these already exist as MVP-06 acceptance signals.
3. **The proposal reuses the MVP-07 lifecycle.** Add a proposal kind for worker
   instructions to `policy-lifecycle.ts`. Record the exact optimizer version,
   reflector model, rollout event IDs, reward table hash, and training-split
   hash as provenance. `proposeRule` stays controller-only.
4. **Evaluation is fixed and held out.** The verifier runs K fresh worker runs
   on scenario variants the optimizer never saw, once with the active
   instructions and once with the candidate. Pass requires zero unsafe or stale
   publications, zero duplicate effects, zero accepted out-of-role tool calls, a
   success rate at least equal to the baseline, and cost within the recorded
   budget. `verifyPolicyActivation` re-checks the binding, as it does today.
5. **Delivery.** Add optional `activeInstructions` beside `activePolicy` in
   `AgentContextPacket`, coordinated through #4. `OpenRouterProvider` uses it
   instead of the fixed system string only when present.

## Hard boundaries

- The instructions are data. They cannot add tools; the role allowlist is still
  enforced server-side on every call.
- The optimizer never sees the held-out split, the verifier code, or the pass
  criteria as tunable input.
- Bounded text (for example, 4 KiB). No secrets, credentials or hidden
  reasoning in rollouts, proposals or evidence.
- Rollback selects a prior version and appends a new event, as for rules.
- Every optimizer or evaluation run makes paid model calls. Each one needs human
  authorization and a stated budget. Provider keys come from the Keychain or an
  encrypted runtime store, never `.env` in images or source.

## Slices

| Slice | Deliverable | Rough effort |
| --- | --- | --- |
| 0. Demo-only (optional) | A Strands harness agent (`create_harness(mcp_servers=...)`) joins the hosted MCP as `strands:demo`: reads context and inbox, publishes a surface. Shows interoperability only; no optimization. | 5–15 min, 1 model run |
| 1. Spike | Confirm the optimizer accepts adapter-built rollouts without a live Strands `Agent`, and which reflector models it supports (Bedrock, Anthropic, OpenAI; OpenRouter unverified). | 30 min |
| 2. Training data | At least ~10 scenario variants split into train and held-out sets, plus a rollout adapter from ledger events. One deterministic scenario gives too little signal. | 1–2 h |
| 3. Proposer | `tools/strands-optimizer/` Python job: read train rollouts, compute verifier rewards, run `ContrastiveReflectionOptimizer`, submit one proposal. | 1–2 h |
| 4. Evaluate, activate, deliver | Lifecycle kind, held-out evaluation, context field, provider use, tests. | 2–3 h |

## Acceptance criteria

- The optimizer's proposal is stored as a `policy_proposed` event with full
  provenance and cannot activate itself.
- A candidate that raises success on the training runs but causes a stale or
  duplicate publication on held-out runs fails evaluation.
- A candidate that tries to reference an out-of-role tool gains no capability;
  the call is rejected and the evaluation fails.
- A passing candidate produces one immutable version, increments the epoch once
  (idempotent under retries), and appears in the worker's next context packet.
- The evidence manifest records actual model names, call counts and cost for
  optimization and evaluation separately.
- No claim of improvement beyond the measured held-out comparison.

## Open questions

- Does `ContrastiveReflectionOptimizer` accept rollouts built outside a Strands
  agent? (Slice 1.)
- Which reflector model and provider, and who approves the spend?
- Owner: this needs a claim on a new issue; it is not part of #16 or #17.

## Sources

- [Harness Optimizer](https://github.com/strands-labs/harness-optimizer)
  (`pip install strands-harness-optimizer`; Formulas, `Trainer`,
  `ContrastiveReflectionOptimizer`, `MultiAgentOptimizer`)
- [Introducing Harness Optimizer](https://strandsagents.com/blog/introducing-harness-optimizer/)
- [Strands harness quickstart](https://strandsagents.com/docs/user-guide/harness/quickstart/)
- [Strands harness MCP servers](https://strandsagents.com/docs/user-guide/harness/configure/mcp-servers/)
