# Hackathon Infrastructure Bootstrap Runbook
## For Codex Desktop — Setup and Verify All Services Before We Define the Product

### Context

We are participating in **The Harness Engineering & Model Wrangling Hackathon** on Sept 26.

The hackathon requires the project to use the **MongoDB Atlas Hackathon Sandbox**. All work must be original, the final repository must be public, and final submission will go through the **Cerebral Valley Platform** with:
- a public GitHub repository,
- a 1-minute demo video showing code + functionality,
- a concise project description.

The actual product idea is **NOT defined yet**.

Your job in this phase is **only to prepare, connect, and verify the development environment and partner services** so that when the product idea is supplied, implementation can start immediately.

Do **not** make architectural or product decisions on our behalf yet.

---

# 0. Operating Rules

Follow these rules strictly:

1. **Do not build the hackathon application yet.**
2. **Do not invent the product idea.**
3. **Do not create agent logic, prompts, evals, memory schemas, or UI flows yet.**
4. **Do not add large frameworks unless they are required to verify an integration.**
5. Use the **MongoDB Atlas Hackathon Sandbox that is already available**.
6. Never commit secrets.
7. Store secrets only in `.env`.
8. Create `.env.example` containing variable names but no credentials.
9. Prefer official SDKs and official setup instructions.
10. If a service cannot be configured automatically, stop at the exact point where user action is required and tell me what to click/do.
11. After configuring each service, perform a minimal smoke test.
12. Record every result in `SERVICE_STATUS.md`.
13. Keep the repo clean enough that we can begin implementing the actual project immediately afterward.

---

# 1. Create the Workspace

Create a new project directory for the hackathon.

Suggested temporary repo name:

```text
harness-hackathon
```

Initialize Git:

```bash
git init
```

Create this minimal structure:

```text
harness-hackathon/
├── README.md
├── SETUP.md
├── SERVICE_STATUS.md
├── .env
├── .env.example
├── .gitignore
├── requirements.txt
├── package.json              # only if required for tooling
│
├── scripts/
│   └── smoke_tests/
│
├── src/
│   └── __init__.py
│
└── docs/
```

Do not add product-specific directories yet.

Add at minimum to `.gitignore`:

```text
.env
.venv/
venv/
__pycache__/
*.pyc
node_modules/
.DS_Store
```

---

# 2. Python Environment

Use Python 3.11+ if available.

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it.

macOS/Linux:

```bash
source .venv/bin/activate
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Upgrade pip:

```bash
python -m pip install --upgrade pip
```

Do not install a large dependency bundle yet.

Only install SDKs as they become necessary for the service smoke tests.

Record the detected Python version in `SERVICE_STATUS.md`.

---

# 3. MongoDB Atlas — CRITICAL

## Requirement

This hackathon requires finalist projects to be built in the **MongoDB Atlas Hackathon Sandbox**.

The sandbox is already available to us.

Do NOT create a random non-hackathon Atlas project.

## Tasks

1. Confirm access to the Hackathon Atlas Sandbox.
2. Identify:
   - organization/project name,
   - cluster name,
   - region,
   - MongoDB version if visible.
3. Verify that the cluster is running.
4. Create a database user if one is not already available.
5. Configure network access appropriately for local development.
6. Obtain a MongoDB connection string.
7. Put it in `.env` as:

```text
MONGODB_URI=
```

8. Add this to `.env.example`:

```text
MONGODB_URI=
```

## Smoke test

Install the official Python driver:

```bash
pip install pymongo
```

Create:

```text
scripts/smoke_tests/test_mongodb.py
```

The test should:

1. connect using `MONGODB_URI`,
2. run a ping,
3. print the active database/cluster connection status,
4. create a temporary collection,
5. insert one test document,
6. read it back,
7. delete the temporary document/collection.

Do NOT create our final hackathon database schema yet.

Expected result:

```text
PASS: MongoDB Atlas connection successful
PASS: write successful
PASS: read successful
PASS: cleanup successful
```

---

# 4. MongoDB Agent Skills

The hackathon resource guide recommends configuring **MongoDB Agent Skills** before building.

The purpose is to give the coding assistant MongoDB-specific best practices for:
- connecting to databases,
- structuring data,
- writing queries,
- implementing search.

## Tasks

1. Determine the current official installation method for MongoDB Agent Skills with **Codex Desktop**.
2. Use official MongoDB instructions.
3. Install/configure the skills for this workspace.
4. Verify that Codex can access or invoke the MongoDB-specific guidance.

Do not assume an installation command if the official docs differ.

Record:
- installation method,
- installed version or source if available,
- verification result.

---

# 5. MongoDB MCP Server

The guide recommends connecting the MongoDB MCP Server so an AI coding assistant can directly interact with MongoDB and Atlas.

The guide mentions:
- MongoDB MCP Server,
- Atlas Managed MCP Server,
- Atlas service-account based access,
- support for AI clients including Codex.

## Goal

Enable Codex Desktop to safely inspect the Hackathon Atlas environment.

## Tasks

1. Determine which of the following is most appropriate for Codex Desktop:
   - MongoDB MCP Server,
   - Atlas Managed MCP Server.
2. Prefer the official supported path.
3. Configure it.
4. Do not expose long-lived credentials unnecessarily.
5. Confirm Codex can perform read operations.

## MCP verification

Ask the MongoDB MCP integration to:

1. list accessible Atlas projects,
2. identify the hackathon project,
3. list clusters,
4. list databases,
5. inspect collection names if any exist.

Do **not** alter production/hackathon data through MCP during this setup stage except for an explicitly temporary test resource.

Write the result in `SERVICE_STATUS.md`.

---

# 6. MongoDB Search Capabilities

We do not yet know what the final idea needs, but the hackathon resources explicitly include:

- Atlas Vector Search,
- Atlas Search,
- Automated Embeddings,
- Embedding and Reranking API.

Do not design indexes yet.

Instead verify what is available in our Atlas Sandbox.

Record:

```text
Atlas Vector Search available: YES/NO
Atlas Search available: YES/NO
Automated Embeddings available: YES/NO/UNKNOWN
Embedding/Reranking API available: YES/NO/UNKNOWN
```

If a feature requires an index or collection to test, do not create a permanent one yet.

---

# 7. Voyage AI

Hackathon participants receive **200 million free Voyage AI tokens**.

Voyage AI provides embeddings and reranking.

## User action if required

If an account/API key does not exist:

1. create a Voyage AI account,
2. navigate to Organization → API Keys,
3. generate an API key,
4. save the key immediately.

Add:

```text
VOYAGE_API_KEY=
```

to `.env` and `.env.example`.

## Setup

Install the official SDK:

```bash
pip install voyageai
```

## Smoke test

Create:

```text
scripts/smoke_tests/test_voyage.py
```

The test should:

1. authenticate,
2. embed two tiny strings,
3. confirm vectors are returned,
4. optionally perform one tiny reranking request if available,
5. avoid wasting credits.

Output something like:

```text
PASS: Voyage authentication successful
PASS: embedding request successful
Embedding dimension: ...
PASS/NOT TESTED: reranking
```

Do not choose our production embedding model yet unless the API requires a model for the smoke test.

Record the model used only for testing.

---

# 8. OpenRouter

The hackathon provides free OpenRouter credits to checked-in participants.

OpenRouter gives access to many model providers through one API.

## User action

Look for the hackathon OpenRouter credit code in the email associated with event check-in.

If needed:
1. create/sign into OpenRouter,
2. redeem the credit,
3. create an API key.

Add:

```text
OPENROUTER_API_KEY=
```

to `.env` and `.env.example`.

## Smoke test

Use the official/recommended OpenRouter API method.

Create:

```text
scripts/smoke_tests/test_openrouter.py
```

Perform **one extremely small completion** using an inexpensive available model.

Example task:

```text
Reply with exactly: OPENROUTER_OK
```

Verify:
- HTTP/API success,
- returned text,
- model identifier.

Do not select the final project model yet.

---

# 9. OpenAI / Codex Credits

The hackathon guide provides **1250 Codex credits** to checked-in participants.

## Tasks

1. Confirm Codex Desktop is authenticated.
2. Confirm the hackathon credit/code has been redeemed if required.
3. Verify Codex can operate inside this repository.
4. Confirm Codex has filesystem access to this workspace.
5. Confirm terminal commands work.
6. Confirm Git operations work.

Do not create any hackathon product implementation yet.

Record:

```text
Codex Desktop authenticated: YES/NO
Hackathon credits redeemed: YES/NO/UNKNOWN
Workspace access: PASS/FAIL
Terminal access: PASS/FAIL
Git access: PASS/FAIL
```

---

# 10. LangSmith / LangChain

The event provides:
- $50 in LangSmith credits,
- Deployments access,
- LangGraph documentation,
- agent starter resources.

This may become useful for tracing/evaluation later, but we do not yet know whether the final project will use LangChain or LangGraph.

## Important

Do **not** add LangChain/LangGraph to the application architecture yet.

Only prepare LangSmith credentials and verify tracing can work independently.

## User action

Redeem hackathon credits using the event redemption flow.

The guide notes that a card may need to be added for credits to display, but it should not be charged merely to display those credits.

Create an API key.

Add:

```text
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=harness-hackathon
```

to `.env`.

Add the same keys without values to `.env.example`.

## Smoke test

Prefer a minimal LangSmith SDK/API test rather than introducing the full LangChain framework.

Verify:
- authentication,
- project access,
- ability to create/log one tiny test trace if supported.

Clean up if appropriate.

Record result.

---

# 11. Vercel

The event provides v0 credits and recommends Vercel for deploying hackathon interfaces.

We do not yet know whether the final product will require a web UI.

## Goal

Prepare deployment capability without building the UI.

## Tasks

1. Verify/sign into Vercel.
2. Redeem the event v0 credits if the code has arrived.
3. Ensure the Vercel CLI is available, or install it if appropriate.
4. Authenticate the CLI.
5. Do NOT create the final frontend.
6. Verify that a minimal disposable project could be deployed.

If useful, deploy a temporary static page containing:

```text
Hackathon infrastructure ready.
```

Then remove the deployment/project if cleanup is straightforward.

Record:

```text
Vercel account: READY/NOT READY
v0 credits: REDEEMED/PENDING
CLI authenticated: YES/NO
Test deployment: PASS/SKIPPED/FAIL
```

---

# 12. ElevenLabs

The event provides one month of the Creator plan for checked-in participants.

The final idea may or may not use speech.

## Goal

Provision access only.

## Tasks

1. Redeem the event coupon through the event Discord flow if available.
2. Create/sign into ElevenLabs.
3. Generate an API key if appropriate.

Add:

```text
ELEVENLABS_API_KEY=
```

to `.env` and `.env.example`.

## Smoke test

Do **not** generate a long audio file.

Use the cheapest/minimal API-level authentication or account-info request available.

If the API requires generation to verify credentials, generate only a tiny test phrase:

```text
test
```

Record result.

Do not add voice features to the project yet.

---

# 13. AWS Kiro

The guide lists AWS Kiro IDE/CLI/Crew with a free tier and new-user credits.

We are already using Codex Desktop, so Kiro is **not required for the initial coding workflow**.

However, record whether we have access.

Do not switch IDEs.

Status options:

```text
Kiro account: AVAILABLE / NOT CONFIGURED
Kiro credits: AVAILABLE / UNKNOWN
Integration required now: NO
```

Unless the actual product idea later needs Kiro-specific functionality, take no further action.

---

# 14. Cerebral Valley Platform

This is the required submission platform.

Verify:

1. We are registered.
2. We are checked in.
3. The correct team exists.
4. Every current team member is attached.
5. We know where the final project submission form is.
6. We know the submission requires:
   - public GitHub repo,
   - 1-minute demo video,
   - concise project description.

Do not submit yet.

Record status.

---

# 15. GitHub Repository

Create a GitHub repository for today's hackathon work if one does not already exist.

Requirements later:
- final repo must be public,
- demo link must be accessible.

For now:

1. initialize repository,
2. set remote,
3. commit only infrastructure/setup files,
4. confirm `.env` is ignored,
5. confirm no API keys are in Git history.

Run a basic secret check before pushing.

Suggested first commit:

```text
chore: bootstrap hackathon infrastructure
```

Do not add any old project code because hackathon work must be original.

---

# 16. `.env.example`

By the end of setup, `.env.example` should look approximately like:

```text
# MongoDB
MONGODB_URI=

# Voyage AI
VOYAGE_API_KEY=

# OpenRouter
OPENROUTER_API_KEY=

# LangSmith
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=harness-hackathon

# ElevenLabs
ELEVENLABS_API_KEY=

# Add additional service credentials only if actually required.
```

Never put real values in this file.

---

# 17. Unified Smoke Test

Create:

```text
scripts/smoke_tests/run_all.py
```

It should run the available service tests and print a compact result.

Example:

```text
==================================================
HACKATHON SERVICE CHECK
==================================================

MongoDB Atlas        PASS
MongoDB MCP          PASS
MongoDB Agent Skills PASS
Voyage AI            PASS
OpenRouter           PASS
OpenAI/Codex         PASS
LangSmith            PASS
Vercel               PASS
ElevenLabs           PASS
Cerebral Valley      MANUAL VERIFIED

==================================================
READY FOR PRODUCT SPEC
==================================================
```

For services that require manual verification, do not fake a PASS.

Use:

```text
MANUAL ACTION REQUIRED
PENDING CREDIT
NOT CONFIGURED
SKIPPED
FAIL
```

as appropriate.

---

# 18. Create `SERVICE_STATUS.md`

Maintain this file throughout setup.

Use this template:

```markdown
# Hackathon Service Status

Last updated: <timestamp>

| Service | Account | Credits | Credentials | Connectivity | Smoke Test | Notes |
|---|---|---|---|---|---|---|
| MongoDB Atlas Hackathon Sandbox | | N/A | | | | |
| MongoDB Agent Skills | N/A | N/A | N/A | | | |
| MongoDB MCP | N/A | N/A | | | | |
| Atlas Vector Search | N/A | N/A | N/A | | | |
| Voyage AI | | | | | | |
| OpenRouter | | | | | | |
| OpenAI / Codex | | | | | | |
| LangSmith | | | | | | |
| Vercel / v0 | | | | | | |
| ElevenLabs | | | | | | |
| AWS Kiro | | | | | | |
| Cerebral Valley | | N/A | N/A | | | |
| GitHub | | N/A | auth | | | |
```

Below the table add:

## Manual Actions Still Required

List only things I personally need to do.

Example:

```text
1. Redeem OpenRouter event code from email.
2. Paste Voyage API key into `.env`.
3. Confirm Cerebral Valley team membership.
```

Then:

## Blocking Issues

List anything that would prevent us from beginning the actual build.

Then:

## Ready-to-Use Capabilities

List verified capabilities, e.g.:

```text
- MongoDB read/write
- MongoDB MCP access
- vector-search availability confirmed
- embeddings API operational
- multi-model LLM endpoint operational
- tracing endpoint operational
- deployment account operational
```

---

# 19. Final Security Check

Before declaring setup complete:

1. Confirm `.env` is ignored.
2. Run:

```bash
git status
```

3. Search the repository for common secret patterns.
4. Verify no raw API key appears in:
   - README,
   - logs,
   - shell scripts,
   - committed files,
   - Git diff.
5. Ensure test scripts load credentials from environment variables only.

If a credential accidentally entered Git history, stop and tell me immediately.

---

# 20. Final Environment Check

Run all smoke tests.

Then provide a final summary in this exact style:

```text
INFRASTRUCTURE BOOTSTRAP COMPLETE

Core:
[ ] MongoDB Atlas Hackathon Sandbox verified
[ ] MongoDB Agent Skills configured
[ ] MongoDB MCP connected
[ ] Atlas capabilities checked

AI / Retrieval:
[ ] Voyage AI working
[ ] OpenRouter working
[ ] Codex working

Observability:
[ ] LangSmith working

Deployment:
[ ] Vercel ready

Optional:
[ ] ElevenLabs ready
[ ] Kiro access noted

Submission:
[ ] Cerebral Valley verified
[ ] GitHub repo initialized
[ ] secrets check passed

BLOCKERS:
- ...

MANUAL ACTIONS FOR USER:
1. ...
2. ...

STATUS:
READY / NOT READY FOR PRODUCT SPEC
```

Do not claim `READY` unless:
- MongoDB Atlas connection works,
- Hackathon Sandbox is verified,
- Codex workspace is operational,
- Git is initialized and secrets are protected.

OpenRouter, Voyage, LangSmith, Vercel, ElevenLabs, and Kiro may be marked pending if credits/accounts require manual redemption, but explicitly identify what remains.

---

# 21. STOP CONDITION

Once infrastructure setup and verification are finished:

**STOP.**

Do not start implementing an agent.

Do not create an application architecture.

Do not invent a use case.

Do not create MongoDB production collections.

Do not create vector indexes.

Do not write prompts.

Do not build a dashboard.

Do not choose the final LLM.

Return the completed `SERVICE_STATUS.md` and wait for me to provide the actual hackathon idea.

The next phase begins only after I give you the product specification.
