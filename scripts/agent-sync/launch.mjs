#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boxes, deliver, rootFor } from './cli.mjs';
import { configuration } from './claude.mjs';
import { startHeartbeat } from './heartbeat.mjs';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function main() {
  const repo = fs.realpathSync(process.cwd());
  execFileSync('git', ['check-ignore', '-q', '.artifacts/context-sync/state.json'], { cwd: repo, stdio: 'ignore' });
  const root = rootFor(repo);
  process.env.CP_SYNC_REPO = repo;
  process.env.CP_SYNC_INSTANCE = randomUUID();
  configuration(process.env, 'validate');
  // Keep the private spool beneath the configured, ignored repository boundary.
  const args = process.argv.slice(2);
  if (args.some(arg => ['--bare', '--safe-mode', '--settings', '--setting-sources'].some(flag => arg === flag || arg.startsWith(flag + '=')))) throw Error('INCOMPATIBLE_FLAGS');
  if (process.env.CLAUDE_CODE_SIMPLE === '1' || process.env.CLAUDE_CODE_SAFE_MODE === '1') throw Error('HOOKS_DISABLED');
  const command = `${quote(process.execPath)} ${quote(fileURLToPath(new URL('./cli.mjs', import.meta.url)))} hook`;
  const hooks = Object.fromEntries(['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'].map(event =>
    [event, [{ ...(event.startsWith('PostTool') ? { matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit' } : {}),
      hooks: [{ type: 'command', command, timeout: 60 }] }]]));
  const settings = path.join(root, `launch-${process.env.CP_SYNC_INSTANCE}.json`);
  fs.writeFileSync(settings, JSON.stringify({ hooks }), { mode: 0o600, flag: 'wx' });
  let child;
  const forward = signal => child?.kill(signal);
  const sigint = () => forward('SIGINT'); const sigterm = () => forward('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  let code, stopHeartbeat;
  try {
    child = spawn('claude', ['--settings', settings, ...args], { cwd: repo, env: process.env, stdio: 'inherit' });
    stopHeartbeat = startHeartbeat({
      boxes: () => boxes(root).filter(box => box.config.instanceId === process.env.CP_SYNC_INSTANCE),
      deliver, isAlive: () => !!child.pid && child.exitCode === null && child.signalCode === null && !child.killed,
      onError: () => console.error('ContextPlane UNSYNCHRONIZED: heartbeat delivery pending; inspect status/flush.'),
    });
    code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally {
    await stopHeartbeat?.();
    process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
    fs.unlinkSync(settings);
  }
  let unsynchronized = false;
  const own = boxes(root).filter(box => box.config.instanceId === process.env.CP_SYNC_INSTANCE);
  if (!own.length) { console.error('ContextPlane: no hook report captured; this client invocation is uncovered.'); unsynchronized = true; }
  for (const box of own) {
    try {
      await box.enqueue({ kind: 'SessionEnd', key: 'launcher-exit', summary: `Claude Code process exited with code ${code}; task outcome not verified` });
      const receipt = await deliver(box);
      if (receipt.pending) unsynchronized = true;
    } catch { unsynchronized = true; console.error('ContextPlane UNSYNCHRONIZED: reports pending or capture failed. Run status/recover/flush.'); }
  }
  process.exitCode = code || (unsynchronized ? 1 : 0);
}
main().catch(() => { console.error('ContextPlane launcher failed; no synchronization guarantee. Check configuration and client flags.'); process.exitCode = 1; });
