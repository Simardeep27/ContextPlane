# Consolidated baseline and MVP handoff

September 26, 2026. Canonical work: [parent #1](https://github.com/Simardeep27/ContextPlane/issues/1).

**Objective:** let the team connect to one reviewed baseline, then finish the
Orders/Billing workflow with exact evidence and a tested coordination rule.
**State:** foundations implemented; later milestones partially implemented.
**Owner:** Simardeep leads MVP-04 onward. Shivraj retains domain/data model
[#20](https://github.com/Simardeep27/ContextPlane/issues/20); Tanish supports HQ
through #2, Buddhsen supports persistence/MCP through #3. Assignment is not a lock.

## What is complete

| Milestone | Evidence available | Remaining acceptance work |
| --- | --- | --- |
| 01 contracts (#11) | Shared scoped types, complete code/dependency/policy version, leases and atomic persistence step | Implemented foundation; preserve the canonical types |
| 02 scenario (#12) | Deterministic Orders/Billing revisions, content hashes, frozen evaluation cases | Implemented foundation; do not replace it with incompatible fixtures |
| 03 context API (#13) | Scoped context/projection/event reads and idempotent N to N+1 publication, reconnect coverage | Implemented demo foundation; loopback fixture sessions are not production identity |
| 04 publication decisions (#14) | Pure decisions and isolated gateway reject stale versions, stale checks and missing acknowledgements | Connect these decisions to shared write handlers and persisted blockers/timeline |
| 05 exact revision runner (#15) | Real staged bytes, consumer integration checks, tamper rejection, exact publication and reconciliation | Shared handler integration and separately required service unit tests; executor currently supports fixed synthetic changes |
| 06 durable worker (#16) | Fenced receipts/checkpoints, actual SIGKILL recovery without duplicate publication | Connect context, real model turns and validated tools; record actual OpenRouter usage for hosted workers; real personal clients stay under #7 |
| 07 rule improvement (#17) | Causal baseline/failure/revert evidence, frozen evaluation, harmful-rule rejection, idempotent epoch activation | Persist proposed rule, evaluation and activation as distinct lifecycle records; return policy through the shared agent context and demonstrate its use |
| 08 observable UI (#18) | HQ reads the API, shows observed dependency revisions/history and stored events; simulation explicitly separate | Wire blocker reasons, staged/tested/published hashes, proposed/evaluated/active rule and receipt details |
| 09 end-to-end demo (#19) | One-command reference, real checks, crash recovery and evidence manifest | One integrated API/worker/MCP/UI path with real client execution, CI and hosted-environment verification |

That is **3 of 9 numbered milestones implemented as foundations**, with reusable
work for the other six. The nine MCP tools are a useful client coordination
extension, not nine completed product milestones.

## Changed and preserved work

- Simardeep's `wireframe` at `d4a69daa32c23b0672dd0810b9f4a5bcac75cf80`:
  contracts, scenario, context API, durable coordination MCP.
- Buddhsen's `buddhh/mcp-worker` at `b016cf81b9ed7e0c14c82eb20f500379450e4c98`:
  HTTP/stdio bridge, worker adapter, transport tests and deployment notes.
- Tanish's `tanish/mvp-08-demo-surface` at
  `bf4909d8b5664bc18987ac7ad65458bb12cf77b4`: HQ visuals and real API reader,
  including the prior `hq-frontend` history.
- Shivraj's reference at `058bc928925e126984c87c4e58a102e70195afa0`:
  domain decisions, exact-code runner, isolated gateway and process E2E.
- Consolidation fixes: API session lookup and event paging; MCP lease expiry,
  retry/CAS and surface-key isolation; explicit gateway/API writer separation;
  HQ runtime read-only boundary and honest simulation; portable local startup.

The separate `tanish/db-mvp-01-02` at
`c6c508d39578d431920a47f285adfc447cb60acc` is preserved, **not imported**.
It duplicates domain records, weakens the full checked-version tuple and changes
the canonical scenario. Its record/CAS test ideas can be ported individually
against canonical contracts. Do not merge a second domain model to retain tests.
The obsolete empty `harness-hackathon` gitlink is removed; its historical commit
was `a4d9c74e9faf9e5d26b8b2836ffccfa17dbb7d09`.

## Settled decisions and limits

Use composition and the ontology; one bounded context-steward responsibility
is enough. MongoDB stores state, events and coordination records. Processes
run outside MongoDB. Personal agents connect to constrained MCP/domain tools.

The local API and MCP share `context_plane_local` and the same demo project.
HQ reads API state. Coordination registrations/messages/surfaces live in the
MCP repository; they do not automatically become migration receipts or HQ run
events. The reference gateway has a different project/database boundary and
rejects attempts to share an API-owned projection. Unifying these write paths
is the next integration task, not something a startup script accomplishes.

The shared MCP token authenticates a project, not an individual agent.
Declared identity and owner fields are trusted team inputs. Per-agent identity,
scoped grants and revocation must be implemented before claiming that boundary.
The API's fixed fixture session names are only safe on its loopback demo server.
The runner is fixed and is not an OS/network sandbox.

Learned and equivalent static rules both score 5/5 on the frozen cases.
The reference has zero model calls. A held-out rule check is not a completed
unseen migration. Do not use this evidence to claim a productivity improvement.

## Next action for Simardeep

Claim [#14](https://github.com/Simardeep27/ContextPlane/issues/14), then connect
the tested core publication decision to one shared API command and persist its
blocked reason and complete checked version. Prove that the MCP/client request
and HQ read observe the same event, then continue #15 through #19. Reuse the
reference's tests and executor instead of creating another set of records.

## Validation and pointers

Run `npm test` and `npm run typecheck`. For local services and client smoke,
see [LOCAL_RUN.md](LOCAL_RUN.md). For fixed-scenario execution and its manifest,
see [E2E_RUNBOOK.md](E2E_RUNBOOK.md). The consolidation verification record is
[INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md).

Local Mongo evidence does not verify Atlas or the hosted Cloudflare deployment.
The last reported hosted deployment only proved the earlier read bridge.
The nine-tool update needs the correct Cloudflare account/token before a new
deployment and hosted smoke; resource config owns credential readiness.
