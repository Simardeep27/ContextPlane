# ContextPlane: shared ontology

Version 1, September 26, 2026. Contract for [issue #9](https://github.com/Simardeep27/ContextPlane/issues/9).
This defines the intended system; it does not claim the services already work.

**People and their agents do tasks. The company harness shares relevant context,
checks shared actions, records outcomes, and tests improvements to its own rules.**

## 1. The units

| Term | Meaning | Example |
| --- | --- | --- |
| **Company** | The membership and authority boundary. Existing API field: `orgId`. | The demo company |
| **Project** | Related work, resources and acceptance criteria within a company. | Orders migration |
| **Environment** | An isolated deployment/data boundary, not necessarily another domain entity or API field. | Shivraj's experiment; team central |
| **Person** | A human identity. Employee means a person's membership in a company. User means an authenticated account, not another kind of worker. | Shivraj |
| **Agent** | A persistent software identity configured to do work. Owned by a person or the company; given a role and explicit permissions. | Shivraj's coding agent; company context steward |
| **Client instance** | One registered runtime instance; it can host several logical agents. | A Codex or Claude runtime instance |
| **Session** | An authenticated interaction period, explicitly bound to the acting agent. Reconnect may resume or replace it without creating a new agent or task run. | One agent's interaction with ContextPlane from that runtime |
| **Task** | Work with an owner and an observable completion condition. | Migrate Orders and Billing while preserving totals |
| **Run** | One execution attempt at a task. Several agents and sessions can contribute. A recoverable process restart continues the run. | Migration attempt 1 |
| **Action** | One requested operation in a run, with a stable operation key and a recorded result. Repeating the same request is a retry; changing its meaning requires a new key. | Stage a change; execute registered tests |
| **Event** | An immutable record that something was requested, reported, decided or observed. | Tests finished; access granted |
| **Resource** | Something work reads or changes, identified and versioned where relevant. | Orders source, an API contract, a database |

These are concepts, not a requirement for twelve services or twelve collections.
A **role** is an assignment such as developer, approver, reader or context
steward. It is not a new kind of person or agent. A **worker** is the process
that runs jobs. A **model** generates suggestions or tool requests; it does not
own permissions, approve itself or become the harness.

An **artifact** is a stored output or evidence: a commit, patch, test report or
document. A **surface** is the versioned part of a resource another task relies
on, such as an API response. A **dependency** records which consumer relies on
which surface version. A **receipt** records what the controlled executor
actually did and the exact inputs/results; a self-report is not a receipt.
Keep both the requesting person/agent and the executing or observing service
identity. Final receipts are immutable; corrections create linked records.

## 2. Ownership and composition

```text
Company
  contains people (members) and projects
  owns company agents
  defines permissions and accepted outcomes

Person -> owns zero or more agents
Client instance -> hosts agents through authenticated sessions
Project -> has tasks -> has runs -> contains actions -> produces events
Run <- receives contributions from authorized people and agent sessions

Company harness = domain tools + authorization + context + durable execution
                + event recording + rule evaluation and activation
```

Use composition, not an inheritance tree. A personal agent is not a subclass
of an employee. A company agent is the same agent type with a company owner and
a role. Ownership does not confer the owner's permissions. Each connection is
bound server-side to its real person or service identity and allowed scope.
Company agents have an accountable human maintainer, but their events identify
the actual service actor; an initiating person is recorded only when one exists.

Two agents belonging to Shivraj can work concurrently on different tasks.
Two instances of the same agent still have distinct instance/session identities.
Reclaiming interrupted work creates a new lease generation, not a new operation.
Neither arrangement permits overlapping writes without the task/resource lease
and revision checks. A GitHub assignee is a planned owner, not an execution lock;
`working: true` is a human coordination label, not a database lease.

## 3. What the harness controls

The **personal harness** is the agent runtime around a model: its loop, prompt,
tools and local context. Codex and Claude retain their own runtimes/providers.

The **company harness** coordinates shared work through authorized domain tools.
It composes with personal harnesses; it does not replace them. Its interfaces are:

- People and the UI: tasks, status, evidence and human approvals.
- Agent clients: authenticated domain calls and returned context/results.
- Atlas: durable company state and evidence, accessed by the service.
- Executors: approved resource operations, versioned changes and registered tests.
- Models: bounded requests for work or summaries; company jobs use OpenRouter.
- Rule evaluation: evidence in, an evaluation report out; a separate controller
  decides activation.

Preserve the established tool names: `get_project_context`, `request_status`,
`report_progress`, `send_agent_message`, `request_access`, `check_access`,
`query_demo_orders`, `propose_change`, `check_change`, `acknowledge_change`,
`stage_change`, `run_checks`, `apply_change`, and `read_operation`.
Client registration/reporting details remain #4's contract responsibility; this
document does not invent replacement endpoints.

MongoDB MCP is a developer connection to database tools. It is not the company
harness. Product agents use constrained domain tools for shared operations.
The company harness can enforce a rule on those operations. It cannot promise
to observe or prevent every shell command or private action in a connected
runtime. Explicit reports and separately tested hooks extend observation only
where installed; the UI must distinguish reported activity from verified work.

## 4. How many company agents now?

| Responsibility | Smallest implementation | Authority |
| --- | --- | --- |
| **Context steward** | One company role in the existing worker. Deterministic selection first; bounded model summarization only when needed. | Read authorized evidence; write derived context/checkpoints through handlers. Cannot alter source evidence, grants or business data, or acknowledge a handoff merely by reading it. |
| **Harness improvement job** | One bounded job, added with #5; “optimizer” is a shorthand for this job. | Propose a coordination rule from outcomes. Cannot activate its own suggestion. |
| **Verifier** | Ordinary code with fixed checks, owned by #5. | Verify results and evaluate rules; return reports. |
| **Activation controller** | Ordinary checked code, integrated by #4. | Activate only passing versions within the approved scope. |

Start with one steward responsibility, not a swarm. Logging, database access,
queues and test execution do not need agents. A steward does not need a model
call for every context request. Work agents can be the team's connected agents
or the internal OpenRouter workers already described in #1.

## 5. Policies: which rules, who changes them?

| Rule family | Owner and place | May the improvement job change it? |
| --- | --- | --- |
| **Access permissions** | Authorized humans; Atlas membership/grant records, enforced by domain handlers. Company boundary, project/task/resource scope and explicit grants. | No. A task prompt or personal agent cannot broaden them. |
| **Coordination rules** | Versioned rules in Atlas, enforced by `check_change` and `apply_change`. Example: a monetary-unit change requires the dependent service update and passing checks. | May propose restricted, non-executable rules. The fixed evaluator and activation controller decide adoption. |
| **Context-selection rules** | Versioned service configuration governing relevance, freshness and allowed context. Authorization filtering always applies. | Allowed by #5 when explicitly selected and independently evaluated. The chosen first demo improves a coordination rule; do not silently expand that experiment. |
| **Execution and acceptance rules** | Reviewed code/test registry: allowed tools, leases, exact code hashes, test requirements, budgets and rule-evaluation criteria. | No. The learner cannot change the definition of success or its own evaluator. |

There is no automatic inheritance of a human's full access by their agent.
Authentication establishes identity; membership establishes company affiliation.
Server authorization checks grants, scope, expiry, revocation and resource/tool
restrictions. Ownership, role names and retrieved text never bypass that check.
An authorized human can issue a new grant through the approval
path; the agent cannot call `approve_access` or `promote_rule`.

Record a proposed rule, its evaluation, and its activation separately. Keep
immutable versions and a current-version pointer. Activation increments
`policyEpoch`; an earlier check cannot authorize a later apply under a different
epoch. Rollback selects a known prior version and records a new event. Neither
rule learning nor rollback changes model weights.

Use precise words: **proposed code change**, **staged code revision**, **proposed
coordination rule**, **active rule**. These are different objects. A passing
test must name the exact staged code hash, not merely the task or agent name.

## 6. Stores: what lives where?

| Store | Contents and purpose | Who writes / how it changes |
| --- | --- | --- |
| **Event ledger** in Atlas | One logical history per company/project/environment, with actor, task/run/action links, time/order, rule version and evidence references where applicable. | Authorized service appends events; people/agents submit reports through it. Corrections append new evidence. Readers see only their authorized scope. |
| **Current state** in Atlas | Membership, agents/sessions, tasks, blockers, grants, leases, run checkpoints, operation status/receipt references, surfaces/dependencies and cursors. Makes current work queryable and restartable. | Domain handlers update with revision/lease checks; consequential transitions also append events. |
| **Rule versions and evaluations** in Atlas | Proposed/tested rule contents, evaluation reports and active-version pointer. | Improvement job submits proposals; evaluator records evidence; controller changes the active pointer. |
| **Artifacts** in Git or an artifact store | Code revisions, patches, full test outputs and documents. Atlas stores IDs/hashes and locations. | Authorized workers/executors produce versioned content. Never replace evidence behind an existing hash. |
| **Derived context** in Atlas or memory | Summaries, search indexes and context packets for an authorized task. Cite source IDs/versions and freshness. | Steward rebuilds/replaces it. It is not authoritative evidence or an authorization source. |
| **Secrets** in Keychain / encrypted runtime secret store | Provider keys and connection credentials. | Human/setup tooling provides them through a safe secret path. Never in the ledger, source, context or ordinary notes. |
| **Application data** in its own resource | The actual Orders/Billing data being changed or queried. | Resource-specific authorized operations. This is not the action ledger. |

These are logical responsibilities, not a new collection layout. Preserve #3's
collection/transaction design and #4's contracts. An operation may first have
pending/retry status in current state; final receipts remain tied to its stable
operation key and immutable event evidence. Related state changes and events
must stay consistent across crashes and retries.

**A person's ledger is a filtered view of this shared ledger.** It is not an
independent source of truth that must later be reconciled with everyone else's.
Agent messages and summaries are evidence of communication, not proof a task
finished. Training signal here means selected evidence used to improve harness
rules, not a model-weight training pipeline or unrestricted transcript capture.

## 7. Experiment and team central

Required setup: Shivraj's experiment environment gets its own database and scoped
credential; use a separate cluster/project only if needed. Every operation/evidence reference
belongs to one environment. The experiment credential must not write central.
If physical infrastructure is shared, database permissions enforce separation.
Exact account and cluster configuration is being established in resource config.

Promote reviewed code/configuration and tested rule versions explicitly. Do not
copy experiment secrets, identities, grants, runs or events into central or
count experiment results as central results. Provisioning, promotion and serving
the demo are separate actions.

## 8. One concrete example

1. Shivraj owns a coding agent; Simar owns another. Each connects with its own
   session to the migration task. A second Shivraj window gets a distinct
   instance/session identity, not a second copy of an already completed action.
2. The Orders agent proposes cents-to-dollars. The steward supplies the Billing
   dependency and its version. The company harness records the shared action.
3. The controlled executor stages that exact revision and runs registered checks.
   Billing fails. The receipt records the failure and code hash; a progress
   message cannot mark the migration accepted.
4. The improvement job proposes a unit-change coordination rule. Fixed evaluation
   includes bad changes and valid coordinated changes. Only a passing rule is
   activated. A competent static-rule baseline is also compared.
5. Work agents repair both services. The exact combined revision passes the
   required checks; the controller permits application. Evidence marks the task
   accepted. Subsequent comparable tasks test whether the rule helps.

The pitch is “agents finish more verified work with less rework.” Measure accepted
tasks against elapsed time, cost and human intervention under comparable budgets.
Logged actions, connected agents and a rising chart alone do not prove that.

## Sources and contract mapping

- [Parent #1](https://github.com/Simardeep27/ContextPlane/issues/1): domain tools,
  authority, exact-revision checks and source bibliography. #3 owns storage,
  #4 runtime/context, #5 verification/improvement, #7 client adapters, #2 UI.
- [JAZ: Harness as a Language](https://arxiv.org/abs/2609.26891) and
  [Continual Harness](https://continual-harness.github.io/): inspiration for
  changing harness state from feedback. This document's company ontology is a
  design choice; their results do not validate our build.
- [Company Brain source](https://github.com/supermemoryai/company-brain/tree/0071d6164991ce5dccddbd645bcac631ee477572):
  reference for shared company context and durable work. Not evidence of our
  proposed rule evaluator.
- [Codex MCP](https://developers.openai.com/codex/mcp/),
  [Claude MCP](https://code.claude.com/docs/en/mcp),
  [Claude hooks](https://code.claude.com/docs/en/hooks), and
  [MongoDB MCP](https://www.mongodb.com/docs/mcp-server/): connection mechanisms,
  not proof of universal observation or automatic enforcement.

Existing issues predate this vocabulary. Translate their prose to the precise
terms above; preserve compatible API fields such as `orgId`, `agentId` and
`policyEpoch`. If an actual contract conflicts, resolve it explicitly in #9/#4
before adding a second meaning or silently changing an API.
