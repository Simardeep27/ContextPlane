# HQ contribution notes

Read the repository AGENTS.md and docs/ONTOLOGY.md. This workspace is the local
React/Vite 3D surface for MVP-08; the API and shared contracts are authoritative.

- Runtime mode is read only and uses the existing MVP-03 demo reader session.
  It is not production authentication. Do not restore commands that impersonate
  Dev B or accept a claimed owner identity from the browser.
- HQ never connects to MongoDB. Explicit `HQ_MODE=simulation` uses memory only.
  Its fake work, identities, checks and decisions must stay visibly labelled.
- Do not introduce a second schema or ledger. `shared/events.ts` is for local
  simulation presentation. Adapt existing API contracts in `shared/runtime.ts`.
- Keep source event IDs, code hashes and evidence references intact. A proposed
  code version or epoch does not prove checks, authorization or policy quality.
- Preserve the scene and panels. Show unknown or missing evidence honestly.
- No URL credentials, private payloads, hidden reasoning or provider prompts may
  reach the browser. Keep the runtime presentation allowlist explicit.

See README.md for modes, commands and remaining acceptance gaps. Run workspace
`typecheck`, `test` and `build`. HTTP tests use local fixtures; do not use a real
Atlas credential or write to shared team data for UI tests.
