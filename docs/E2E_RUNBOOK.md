# Run the isolated reference demo

Latest resource update: the user chose the existing personal cluster while the team finishes shared setup. Its intended app database is `context_plane_poc`; its SRV hostname is not verified and its credential form remains unsubmitted. The personal secret location is `context-plane-personal/MONGODB_URI` in Keychain, tried before the separate team and historical lab entries. Atlas runs require the verified nonsecret `ATLAS_EXPECTED_HOST` explicitly; there is no team-host default. The isolated E2E test database remains `shivraj_experiments`; this proposed test target and effective access still need confirmation before live execution. The app database is never a fallback. Earlier team-cluster setup details below are historical context, not an active personal-credential handoff.

Node 24 and npm are required. From this checkout:

```sh
npm ci
npm run demo:e2e
```

This builds all packages, starts an authenticated loopback HTTP worker, connects two scripted agents, executes the migration, kills the worker after its filesystem publication, restarts it, and verifies recovery without a duplicate publication. It writes a sanitized evidence manifest under `.artifacts/e2e/<run>/manifest.json`. File mode uses a test-only single-process store through the real persistence adapter. It does not establish MongoDB connectivity or MongoDB durability.

For the live database path, use the existing team database user through the resource-config setup. A new login is not required. Verify that it may access the isolated test database before running writes. Store the complete driver URI using the hidden Terminal prompt, never chat:

```sh
cd /Users/apple/Projects/nyc-harness-tech-lab
bash scripts/store-team-secret.sh MONGODB_URI
```

Then run `npm run demo:atlas` from this checkout. The driver reads `MONGODB_URI` from its environment, `context-plane/MONGODB_URI` in macOS Keychain, or the older lab Keychain entry. It never prints it. The worker pings and initializes only `shivraj_experiments`; this target cannot be overridden by a client or URI database path. Each test uses a fresh project/run inside that database. It creates indexes and `cp_*` records; it does not drop a database or touch the team's app database. Retain the manifest and remove only that run's test data through a separately reviewed cleanup if necessary.

The code targets the existing team cluster with a separate test database. `shivraj_experiments` is a proposed setup label, not a separate product or a provisioned database. Resource config canceled the unused `shivraj_lab` login draft after finding an existing team user. Effective permissions and live access remain unverified. A new cluster is unnecessary for the first test. Shared cluster admins can access both databases, and the workloads share cluster capacity. Local execution needs no Vercel/AWS deployment. Remote team clients need a separately configured hosted domain gateway; the team's existing read-only MCP endpoint does not implement this write workflow.

## A 45-second demonstration

1. **0–8s:** Two agents share one migration. Billing publishes dependency revision 8 while Orders still proposes revision 7.
2. **8–18s:** The harness blocks stale publication. A diagnostic executes the incompatible code: Billing fails. Reverting the Orders change restores the passing test.
3. **18–30s:** Orders requests Billing's coordination. The exact combined revision passes real tests and publishes. A worker crash resumes from its receipt without doing the effect twice.
4. **30–40s:** The harness derives a narrow coordination rule. Five registered examples include valid changes that must remain allowed. Only the passing rule activates; the next session receives it.
5. **40–45s:** Show test evidence, the publication hash and the new context. Say: “Shared work is checked, recoverable, and carries tested lessons into the next session.”

This is an operator script over a real reference test, not a claim the full command takes 45 seconds. It makes zero model calls. The fixed rule and equivalent static baseline both score 5/5. Display these results directly; do not chart invented productivity growth. Real agent integration and live Atlas results must be shown separately, with their own evidence.

## Package ownership

Contracts, persistence and scenario come from team commit `f2ce3ca553e251cb41a47534339bd484c2344308`. New core, runner, gateway and E2E packages are the isolated reference implementation for #14/#19/#20. They do not replace Simardeep's active MVP work, Buddhsen's MCP transport or Tanish's UI. The JSON transport is explicitly not MCP. No process monitors every command a personal agent runs.
