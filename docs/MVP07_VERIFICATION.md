# MVP-07: durable coordination-rule lifecycle

Issue: [#17](https://github.com/Simardeep27/ContextPlane/issues/17).
Shivraj explicitly reactivated this scope on September 26, 2026. MVP-06 remains
separate work; these changes do not start the team API or seed shared data.

## Behavior

The existing `learnFromFailure` entry point now resumes three separately committed
operations. Each uses the existing fenced `commitStep` to store an immutable
event, final receipt, checkpoint and projection together:

1. `policy_proposed`: a restricted `PolicyCandidate`, the causal diagnosis event,
   exact rule/dataset hashes, target agent, evidence and deterministic provenance.
2. `policy_evaluated`: a reference to that proposal event, a hash of the complete
   candidate, and the fixed evaluator's decisions, counts and dataset hash.
3. `policy_activated`: references to the proposal and evaluation events plus the
   immutable `PolicyVersion`. Only this step updates the active pointer and epoch.

`proposeRule`, `evaluateRule` and `activateRule` are controller-only methods in
the existing gateway. They are not new agent tools. The learner cannot select a
dataset, submit a passing verdict, edit permissions or activate through an agent
credential. Activation independently re-evaluates the stored candidate, verifies
the exact recorded evaluation, and checks the base epoch before changing it.
Repeated activation of the same target/rule/dataset keeps the original version.
The existing `/controller/learn` route remains compatible.

The gateway's next context response includes a typed `agentContext` packet for
MVP-06's model adapter, alongside the existing fields. Its `activePolicy` is
present only for the targeted agent. The policy is also persisted in the shared
`ProjectProjection`; the context API reads and filters that optional field.
The additive fields are coordinated through issue #4. No collection or service
was added, and no model weights or acceptance checks are changed.

## Verification coverage

- Separate lifecycle records and receipt references, target filtering and restart
  reads of the active pointer.
- Lost commit responses after proposal, evaluation and activation; retry resumes
  with exactly one record per phase and one epoch increment.
- Agent credentials cannot propose/evaluate/activate through controller methods.
- Altered proposal target/evidence/epoch or evaluation verdict/reference rejected.
- A harmful rule that blocks a valid coordinated change fails evaluation and
  cannot activate. Existing core tests cover unrelated failures and causal proof.
- A deterministic client consumes the next packet for held-out revision 19 and
  sends an addressed coordination request before staging. This proves policy use,
  not a completed unseen migration or autonomous model behavior.
- The process E2E manifest records the three lifecycle event IDs and the policy
  hash actually returned in the context packet.

Run `npm test`, `npm run typecheck`, and `node packages/e2e/dist/run.js` after
building. All execution fixtures remain local and isolated. Hosted Atlas/MCP
execution is not established by these tests. The gateway and context API retain
their existing writer-isolation boundary; integration of their write paths and
MVP-06's real provider loop remain separate work.

## Observed local results (September 26, 2026)

- `npm test`: passed all 105 unit/integration tests and the file-backed process
  E2E (the suite includes it). MCP/HQ socket tests required execution outside
  the filesystem sandbox.
- `npm run typecheck`: passed all workspaces.
- `node packages/e2e/dist/run.js`: passed independently; eight rejected cases,
  two publications, exact artifact hashes, actual SIGKILL recovery, learned and
  equivalent static rules both 5/5. No model calls are claimed.
- `git diff --check`: passed.
