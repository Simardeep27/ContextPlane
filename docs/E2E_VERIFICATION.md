# Reference verification, September 26, 2026

Local Node 24.19.0 validation: root build, typecheck and tests pass. There are 48 package tests (contracts 5, core 8, gateway 5, persistence 18, runner 7, scenario 5), plus the executable process E2E. The E2E rejects 8 negative cases, publishes exactly 2 synthetic artifacts, and proves the tested and published code hashes match.

The driver kills the actual worker with SIGKILL after the publication effect and before its final persistence commit. A fresh worker/session resumes the same run, reconciles the saved authorized intent, and produces no duplicate publication. It separately executes baseline pass → changed consumer failure → revert pass, then the coordinated passing change. Five policy examples pass, as do fresh epoch checks; the equivalent static rule also scores 5/5.

Commands: `npm test`, `npm run typecheck`. Full local output is in `.artifacts/verification-final.log`; the corresponding manifest is `.artifacts/e2e/9fc9d82cfd8740d19f991b0566d60f9b/manifest.json`. These ignored paths are reproducible local evidence, not remotely hosted artifacts. `npm run demo:e2e` emits a fresh sanitized manifest with the checkout commit and dirty-state marker.

Atlas mode was attempted and stopped before connection because no URI was available in the environment or configured Keychain entries. Zero live database writes, new databases/users/clusters, deployments, model calls or inference spend were made by this reference test. The resource setup draft was canceled; existing team credentials are being arranged separately. Browser access to Atlas is not driver validation.

The clients are scripted HTTP callers, not integrated Codex/Claude MCP sessions. Source changes and rule derivation are deterministic. Held-out revision inputs test rule decisions; they do not establish an unseen completed migration or company productivity uplift. Acknowledgements are attributed self-reports; real registered tests verify compatibility. The runner is bounded but is not an OS/network sandbox. See [runbook](E2E_RUNBOOK.md) and [model](DOMAIN_MODEL.md).
