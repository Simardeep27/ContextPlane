# Durable OpenRouter worker

MVP-06 adds real model turns to the existing fenced gateway. It preserves the
reference runner and MVP-07 policy lifecycle. This is an isolated implementation
lane for issue #16; Simardeep remains milestone owner and acceptance is pending.

## Execution and recovery

`runAgent` (`@context-plane/gateway`) accepts a server-created harness, credential,
stable job key, task, provider and turn budget. `OpenRouterProvider` calls the real
OpenRouter chat-completions endpoint. The model receives scoped gateway context,
including the targeted `agentContext.activePolicy`, plus registered tool schemas
intersected with the credential's role. Model output never supplies identity,
scope, permissions or a publication operation key.

Each inference first commits a started receipt, event and checkpoint with its
request. A heartbeat renews the run lease during the external call. The response
journal captures selected response fields before the terminal atomic commit:
actual returned model, generation ID, prompt/completion/total tokens, measured
round-trip latency, finish reason, visible response and tool requests. Raw
provider bodies, authorization headers and hidden reasoning fields are excluded.

Tool calls are dispatched sequentially, validated by the existing domain handlers,
and assigned stable host-generated keys. Their outcomes, including reads and
rejections, are saved for the next assistant/tool conversation. A model final
response is a self-report, not proof that the migration passed acceptance.

Restart the same run with its durable storage, runner artifacts, inference journal,
credentials, job key, task and model configuration. Saved model responses and tool
outcomes replay without provider calls. Pending publication reconciles against the
runner's exact proof before terminal commit. A stale lease generation cannot commit.
The bounded worker reserves receipt capacity before issuing new external work.

The response journal must remain with the run. A crash after submitting inference
but before capturing the response is ambiguous: the worker stops with
`INFERENCE_OUTCOME_UNKNOWN` instead of automatically charging for another call.
Investigate provider activity and preserve the pending intent; there is no claim
of provider-side exactly-once billing or automatic recovery of an unknown response.
The journal supports process-restart evidence, not a distributed artifact service
or a power-loss durability guarantee.

## Reproduce the live acceptance run

Supply `OPENROUTER_API_KEY` through the existing private environment/secret loader.
Do not paste a key into a command, file, issue or log. Then run:

```sh
OPENROUTER_MODEL=openai/gpt-4.1-mini npm run worker:live
```

This explicitly opted-in test makes billed provider requests. It creates a unique
file-backed project under `.artifacts/worker-live/`, never connects to MongoDB,
and never resets or seeds team Atlas. Billing setup and acknowledgement are fixed
host actions. The Orders model must propose/check the stale candidate, coordinate
the corrected candidate, then stage, test and publish it. A real SIGKILL occurs
after publication but before its final database receipt. Restart must reconcile
that same model-requested operation with exactly one corrected publication.

The sanitized manifest records each returned generation/model and usage, exact
candidate hash, restart signal, reconciliation and publication counts. The ordinary
`npm test` suite remains offline with respect to OpenRouter; mocked-provider tests
verify protocol/fencing and are not presented as real inference evidence.

## Boundaries

- Fixed synthetic candidates and registered consumer checks remain the executor's
  limits. No arbitrary code execution or OS/network sandbox is introduced.
- Gateway state remains isolated from the separate shared API/MCP write path.
  This patch does not deploy a hosted worker or claim shared Atlas execution.
- Existing personal clients keep their provider/runtime; OpenRouter applies to this
  company worker only. No new automatic client activity capture is claimed.
- The direct reference gateway retains its explicit Billing publication grant;
  model dispatch intersects that configuration with the canonical role allowlist.

Provider wire format follows [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
and [tool calling](https://openrouter.ai/docs/guides/features/tool-calling). Provider
routing requires support for the requested parameters; unsupported reasoning or
parallel-call parameters are deliberately omitted for the selected model.
