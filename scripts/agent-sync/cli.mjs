#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Outbox, privateDir, recoverLocks } from './outbox.mjs';
import { configuration, hookEnvironment, observation } from './claude.mjs';
export function rootFor(repo) {
  if (!repo || !path.isAbsolute(repo)) throw Error('REPOSITORY_REQUIRED');
  const artifacts = path.join(repo, '.artifacts');
  if (fs.existsSync(artifacts) && fs.lstatSync(artifacts).isSymbolicLink()) throw Error('UNSAFE_OUTBOX');
  fs.mkdirSync(artifacts, { recursive: true });
  const root = path.join(artifacts, 'context-sync'); privateDir(root); return root;
}
export function boxes(root) {
  return fs.readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name)).flatMap(name => {
    const file = path.join(root, name, 'state.json');
    if (!fs.existsSync(file)) return [];
    if (fs.lstatSync(path.dirname(file)).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) throw Error('UNSAFE_OUTBOX');
    return [new Outbox(root, JSON.parse(fs.readFileSync(file, 'utf8')).config)];
  });
}
export async function deliver(box) {
  let remote;
  try { const { connect } = await import('./transport.mjs'); remote = await connect(); return await box.flush(remote.call); }
  finally { await remote?.close().catch(() => {}); }
}
export function repoFor(env, cwd = process.cwd()) {
  const repo = env.CP_SYNC_REPO || env.CLAUDE_PROJECT_DIR || cwd;
  try { return fs.realpathSync(repo); } catch { return repo; }
}
async function main() {
  const mode = process.argv[2];
  const repo = repoFor(process.env);
  if (mode === 'hook') {
    let raw = ''; let tooLarge = false;
    for await (const chunk of process.stdin) {
      if (Buffer.byteLength(raw) + chunk.length > 1024 * 1024) { tooLarge = true; raw = ''; }
      if (!tooLarge) raw += chunk;
    }
    if (tooLarge) throw Error('HOOK_INPUT_TOO_LARGE');
    // Project-settings hooks (`hook --project`) defer to the launcher's own hooks when it is active.
    if (process.argv[3] === '--project' && process.env.CP_SYNC_INSTANCE) return;
    const input = JSON.parse(raw); const observed = observation(input);
    if (!observed) return;
    const env = hookEnvironment(process.env, input, repo);
    if (!env) return; // No token or identity: reporting is off, never disturb the session.
    const box = new Outbox(rootFor(repo), configuration(env, input.session_id));
    await box.enqueue(observed); // Persist before any attempted network operation.
    const receipt = await deliver(box);
    console.log(JSON.stringify({ systemMessage: `ContextPlane transport: ${receipt.delivered} reports stored, ${receipt.pending} pending. Task outcome not verified.` }));
  } else if (mode === 'flush' || mode === 'recover' || mode === 'status') {
    const root = rootFor(repo);
    if (mode === 'recover') recoverLocks(root);
    for (const box of boxes(root)) {
      if (mode === 'recover') recoverLocks(box.dir);
      const result = mode === 'flush' ? await deliver(box) : { pending: box.read().pending.length };
      console.log(JSON.stringify({ identity: box.config.identity, ...result }));
    }
  } else throw Error('USAGE_hook_flush_recover_status');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never echo SDK errors, hook input, environment, URLs or raw server responses.
    const safe = new Set(['OUTBOX_FULL', 'OUTBOX_BUSY_OR_INTERRUPTED', 'SURFACE_WRITER_CONFLICT', 'SURFACE_READBACK_FAILED',
      'HOOK_INPUT_TOO_LARGE', 'LOCK_OWNER_ALIVE', 'LOCK_OWNER_UNKNOWN', 'INVALID_TASK_REFERENCE', 'INVALID_IDENTITY',
      'INVALID_PERSON', 'INVALID_INSTANCE', 'INVALID_SESSION', 'UNSAFE_OUTBOX', 'REPOSITORY_REQUIRED', 'MCP_UNAVAILABLE',
      'MISSING_TOKEN', 'INVALID_RECIPIENT']);
    console.error(`ContextPlane UNSYNCHRONIZED: ${safe.has(error.message) ? error.message : 'CAPTURE_OR_DELIVERY_FAILED'}. Inspect status; recover interrupted locks with all clients stopped, then flush. No verified task outcome claimed.`);
    // A hook must never fail the user's session: report on stderr, exit 0.
    process.exitCode = process.argv[2] === 'hook' ? 0 : 1;
  });
}
