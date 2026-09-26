# Domain and data model for the reference E2E

This implements a narrow slice of the [shared ontology](https://github.com/Simardeep27/ContextPlane/blob/7b6cd5daf404af4041773d6823376ed850b16f6d/docs/ONTOLOGY.md), issue #20. The shared TypeScript names remain compatible. In prose, `CandidateHash` means **proposed code hash**, not a new kind of agent or task.

## Units and authority

| Unit | Representation in this slice | Authority |
| --- | --- | --- |
| Company and project | `ProjectScope {orgId, projectId}` | Fixed by service configuration; clients cannot choose another scope. |
| Person | `personId` in a credential mapping | Accountable owner of an agent. |
| Agent | Stable `agentId`, owner and role | Calls its fixed allowed domain tools. |
| Session | Separate `sessionId` for each credential | Two sessions can act as one logical agent; they do not duplicate a run. |
| Task/run | One synthetic Orders/Billing migration and `runId` | Restart resumes the same run with a new lease generation. |
| Action | Tool + exact input + stable operation key | Same input/key replays; changed input/key conflicts. |
| Code change | Hash, declared dependency revision, policy epoch | Actor may propose only a registered change it owns. |
| Check | Exact staged revision, test registry, evidence hashes | Produced by the executor, not the agent's progress report. |
| Rule | Non-executable unit-change coordination data | Derived from controlled failure evidence; fixed tests decide activation. |
| Receipt | Immutable terminal result for one action | Executor evidence reconciles a crash after its filesystem effect. |

No inheritance hierarchy: people own agents; sessions authenticate agents; runs contain actions. The company harness composes a gateway, domain checks, context selection, executor and storage. A context steward is a responsibility, not a separate database or mandatory model process.

A client instance is the running HTTP caller in this slice, with no persisted enrollment record yet. One proposed hash has staged revisions (`StagedCandidate.revision`), successful or failed check records (`CheckResult.checkResultId`), and at most one publication effect per exact version tuple. Re-staging invalidates the prior check. `DependencyRevision.revision` names the consumed service version; `policyEpoch` names the enforced rule set. Neither is an agent identity or a GitHub claim.

## Verbs and invariants

`propose_change` records the proposed version. `check_change` reports missing coordination or stale versions. `send_agent_message` addresses a request; `acknowledge_change` binds the recipient's response to its exact version. An acknowledgement remains a self-report; it does not replace a real consumer test.

`stage_change` materializes registered bytes. `run_checks` executes the fixed consumer test against them. `apply_change` requires the exact successful check, current dependency/rule versions and required acknowledgement. The executor publishes the checked bytes and an effect receipt atomically. Retrying the same authorized operation reconciles that receipt. A different operation cannot adopt it.

`report_progress` records a report, explicitly marked unverified. `get_project_context` selects authorized messages, work, publications and the acting agent's active rule. `read_operation` returns only an operation owned by the acting agent. Unsupported tools fail closed.

The controller separately runs baseline → changed code → revert with the same consumer bytes and registered tests. Only pass → fail → pass supports this bounded unit-change lesson. Evaluation includes unsafe changes, valid changes and unrelated failure. Activation changes the rule epoch, not permissions, models, test definitions or source evidence.

| Command | Actor / input | Required state and resulting transition | Evidence / failure |
| --- | --- | --- | --- |
| Propose / inspect | Change owner; hash + dependency revision + rule epoch | Registered bytes and declared dependency; record proposal and decide current/stale | Reason codes; unknown hash, wrong owner or false dependency declaration rejected. |
| Send / acknowledge | Sender / addressed consumer; request or exact proposed version | Recipient exists; ack requires an addressed request at the current version | Message and attributed self-report; stale or unaddressed ack rejected. |
| Stage | Change owner; hash + complete artifact hashes | Coordination/version checks pass; stage revision advances, prior check cleared | Started intent then staged record; unexpected artifacts rejected. |
| Run checks | Change owner; hash + fixed registered commands | Existing stage and current coordination/version; execute and bind result | Started intent, exact check + evidence; arbitrary commands rejected. |
| Apply | Change owner; version + stable operation key | Current stage and exact passing check authorize effect; effect becomes published | Started authorization and final receipt; stale/mismatched checks rejected. |
| Diagnose | Controller only; operation key | Dependency 8 exists; run three controlled checks without publication | Independent pass/fail/pass evidence; causality mismatch rejected. |
| Learn / activate | Controller only; operation key | Diagnosis exists; derive bounded rule and evaluate fixed dataset | Rule + evaluation + activation recorded; failing rule rejected, identical active rule is a no-op. |
| Read context / operation | Authenticated scoped agent | Read its applicable rule, addressed context, or own receipt | Read only; another scope or agent's receipt rejected. |

Each successful mutating command appends `harness.<tool>.finished`, its receipt, checkpoint and projection in one transaction. Stage/check/apply also persist `harness.<tool>.started` before executor work. Stored payloads carry the request digest and authenticated person/agent/session. Retrying the same key returns the original terminal result across sessions; any changed meaning conflicts. Admission failures return a code without creating a successful receipt; they are not a complete security-audit stream. This is an explicit observation limit.

The lifecycle is **proposed → stale/rejected**, or **proposed → coordinated → staged → checked → authorized → published**. Authorization lives in the durable started apply intent; a crash preserves that intent. Pending publication freezes its proposed tuple until reconciliation. A failed check may be replaced only after a new valid stage/check, never by an agent's claim of success.

## Stores and processes

| Location | Records | Mutation |
| --- | --- | --- |
| Atlas `cp_events` | Ordered domain events, actor/session attribution, exact rule/check evidence and reconstructable state | Service append only; agent input cannot write it directly. |
| Atlas `cp_runs` | Run checkpoint and expiring worker lease | Lease-fenced revision updates. |
| Atlas `cp_receipts` | Pending action and terminal receipt | Stable operation key; terminal result immutable. |
| Atlas `cp_projects` | Current projection and transaction guard | Project revision compare-and-set. |
| Local runner directory | Registered source bytes, check output and published synthetic artifact | Hash checked; atomic publication directory plus receipt. |
| Process configuration | Demo people/agents/sessions and fixed permissions | Service startup only; not learned. |
| Keychain / encrypted service secrets | URI or provider credentials | Never copied into events, artifacts or context. |

These are the existing persistence adapter's four collections. The reference worker reconstructs state, including messages and active policy, from its run events. This bounded implementation stores state snapshots with events; it is not a production event-store schema or general task scheduler. Production membership, grant lifecycle, enrollment, arbitrary tasks, policy rollback and incremental projections remain separate integration work.

All records include company/project scope; run-linked records also include `runId`. Collections enforce unique `(orgId, projectId, key)`; events additionally enforce a unique ordered cursor. Event identity is immutable. Checkpoints require monotonically increasing revisions and the live lease generation. Project projections use revision compare-and-set. Receipts may transition from started to terminal but cannot replace a terminal result. The gateway atomically couples these records through `commitStep`; the executor effect is outside that transaction and reconciles through its own exact receipt.

The always-enforced company checks are identity, scope, lease, source/check binding and static coordination. The derived rule targets the Orders agent and appears in its next context. It adds a versioned requirement without weakening those checks. Another agent's context does not expose that private active rule. Immutable events preserve earlier versions; the current state points to the latest accepted rule. Full rollback is specified by the ontology but unimplemented in this slice.

## Worked concurrent trace

Billing's person has agent B/session B1; Orders' person has agent A/sessions A1 and A2. B1 publishes its registered rounding fix at dependency 8. A1's proposal still declares 7 and is refused. The controller executes the broken code diagnostically and records pass/fail/pass evidence; it does not publish it. A1 proposes the coordinated version and addresses B. B1 acknowledges that exact request; tests independently verify both services. A1 starts apply, the executor publishes, then the process dies before the final database receipt. A2 retries the same action after lease expiry. The new worker proves the existing effect belongs to the saved authorization and commits one terminal result. A duplicate A1 retry returns it without another effect.

After evaluation, rule epoch 2 reaches A2's context. An old acknowledgement no longer satisfies the new epoch; a fresh addressed response does. Separate held-out revision inputs exercise the rule decision function. This is shared authorized task context, not unrestricted shared memory or proof of an unseen autonomous migration.

Each person's “ledger” is a view of one shared event history. MongoDB hosts records. The worker and the people's agents are processes outside MongoDB. Direct MongoDB MCP is useful for authorized development; product agents should use the domain service so identity and action checks apply.

## Proven boundary

The test uses two scripted agent identities across three sessions, loopback HTTP, fixed source changes and deterministic rule derivation. It executes real code and a real process crash. It does not prove Codex/Claude MCP enrollment, general autonomous coding, model learning or company productivity. The learned rule and an equivalent static rule both pass the same five examples; no uplift is claimed.
