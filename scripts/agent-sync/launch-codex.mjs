#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { configuration } from './codex.mjs';
import { rootFor, boxes, deliver } from './cli.mjs';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function main() {
  const repo = fs.realpathSync(process.cwd());
  execFileSync('git', ['check-ignore', '-q', '.artifacts/context-sync/state.json'], { stdio: 'ignore' });
  const root = rootFor(repo);
  const command = `${quote(process.execPath)} ${quote(fileURLToPath(new URL('./codex-hook.mjs', import.meta.url)))}`;
  const hooks = Object.fromEntries(['SessionStart', 'PostToolUse', 'Stop', 'SessionEnd'].map(event => [event, [{
    ...(event === 'PostToolUse' ? { matcher: '^(Bash|apply_patch)$' } : {}),
    hooks: [{ type: 'command', command, timeout: event === 'SessionEnd' ? 3 : 30 }],
  }]]));
  const dir = path.join(repo, '.codex'), file = path.join(dir, 'hooks.json');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('UNSAFE_CONFIG');
  fs.mkdirSync(dir, { recursive: true });
  const text = JSON.stringify({ hooks }, null, 2) + '\n';
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, 'utf8') !== text) throw Error('EXISTING_HOOK_CONFIG');
  } else fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
  // Local generated configuration contains absolute machine paths. Keep it out
  // of commits without changing the project's tracked ignore rules.
  const exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' }).trim();
  if (!fs.readFileSync(exclude, 'utf8').split('\n').includes('/.codex/hooks.json')) fs.appendFileSync(exclude, '\n/.codex/hooks.json\n');
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--setup') {
    console.log('Project hooks configured. Start Codex here, review and trust these hooks with /hooks, then exit and launch again through this wrapper. No hook trust was changed.'); return;
  }
  // No hook-trust, sandbox, approval, config-layer or working-root overrides.
  if (args.some(arg => ['--dangerously-bypass-hook-trust', '--dangerously-bypass-approvals-and-sandbox', '--ignore-user-config', '--ignore-rules', '--config', '-c', '--cd', '-C', '--profile', '-p', '--disable'].some(flag => arg === flag || arg.startsWith(flag + '=')))) throw Error('INCOMPATIBLE_FLAGS');
  process.env.CP_SYNC_INSTANCE = randomUUID(); process.env.CP_SYNC_REPO = repo; process.env.CP_SYNC_CODEX = '1';
  configuration(process.env, 'validate');
  const child = spawn('codex', args, { cwd: repo, env: process.env, stdio: 'inherit' });
  const int = () => child.kill('SIGINT'), term = () => child.kill('SIGTERM');
  process.on('SIGINT', int); process.on('SIGTERM', term);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (c, signal) => resolve(c ?? (signal === 'SIGINT' ? 130 : 143))); }); }
  finally { process.off('SIGINT', int); process.off('SIGTERM', term); }
  const own = boxes(root).filter(box => box.config.instanceId === process.env.CP_SYNC_INSTANCE && box.config.client === 'codex-hooks');
  let pending = !own.length;
  if (!own.length) console.error('ContextPlane UNCOVERED: no Codex hook was captured. Review /hooks trust and restart through this launcher.');
  for (const box of own) {
    try {
      await box.enqueue({ kind: 'SessionEnd', key: 'launcher-exit', summary: `Codex process exited with code ${code}; task outcome not verified` });
      if ((await deliver(box)).pending) pending = true;
    } catch { pending = true; console.error('ContextPlane UNSYNCHRONIZED: Codex reports remain pending. Inspect status/recover/flush.'); }
  }
  process.exitCode = code || (pending ? 1 : 0);
}
main().catch(() => { console.error('ContextPlane Codex launcher failed. Check identity, flags, existing hook config and repository permissions. No synchronization guarantee.'); process.exitCode = 1; });
