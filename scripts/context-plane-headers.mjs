#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
export const localMcpUrl = 'http://127.0.0.1:8010/mcp';

export function loadLocalToken({ create = false } = {}) {
  try {
    const value = execFileSync(process.env.CONTEXT_PLANE_PYTHON ?? 'python3',
      [resolve(directory, 'local-token.py'), 'pipe', ...(create ? ['--create'] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4096, timeout: 120_000 }).trim();
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new Error();
    return value;
  } catch {
    throw new Error('Local MCP token unavailable. Run python3 scripts/local-token.py ensure, or supply CONTEXT_PLANE_LOCAL_TOKEN securely.');
  }
}

function main() {
  const mode = process.argv[2];
  if (mode !== undefined && mode !== '--stdio') throw new Error('Expected no arguments or --stdio.');
  const token = loadLocalToken();
  if (mode === '--stdio') {
    const bridge = spawn(process.execPath, [resolve(directory, '../packages/mcp/dist/bridge.js')], {
      stdio: 'inherit',
      env: { ...process.env, CONTEXT_PLANE_MCP_URL: localMcpUrl, CONTEXT_PLANE_API_TOKEN: token },
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bridge.kill(signal));
    bridge.once('error', () => { console.error('LOCAL_MCP_BRIDGE_FAILED'); process.exitCode = 1; });
    bridge.once('exit', code => { process.exitCode = code ?? 1; });
  } else {
    if (process.stdout.isTTY) throw new Error('Headers are private protocol output. Do not run this helper directly in a Terminal.');
    process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
