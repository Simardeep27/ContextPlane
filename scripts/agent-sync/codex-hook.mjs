#!/usr/bin/env node
import { Outbox } from './outbox.mjs';
import { rootFor, deliver } from './cli.mjs';
import { configuration, observation } from './codex.mjs';
// Hooks stay inert for clients not explicitly enrolled by the launcher.
async function main() {
  if (!process.env.CP_SYNC_CODEX) return;
  let raw = ''; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Error('HOOK_INPUT_TOO_LARGE');
    raw += chunk;
  }
  const input = JSON.parse(raw), observed = observation(input);
  if (!observed) return;
  const box = new Outbox(rootFor(process.env.CP_SYNC_REPO), configuration(process.env, input.session_id), undefined, 250);
  await box.enqueue(observed);
  // Codex allows at most three seconds for SessionEnd. No network, SDK loading,
  // lock recovery or background child is started in that boundary.
  if (observed.kind === 'SessionEnd') return;
  const result = await deliver(box);
  console.log(JSON.stringify({ systemMessage: `ContextPlane: ${result.delivered} reports stored, ${result.pending} pending; outcome not verified.` }));
}
main().catch(() => { console.error('ContextPlane UNSYNCHRONIZED: Codex capture or delivery failed. Inspect status and flush; no verified outcome claimed.'); process.exitCode = 1; });
