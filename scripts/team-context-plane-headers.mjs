import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTeamEnvironment } from './team-environment.mjs';
// Prefer the runtime environment (secret store); fall back to the private .env.
const runtimeToken = () => process.env.CONTEXT_PLANE_API_TOKEN ? { CONTEXT_PLANE_API_TOKEN: process.env.CONTEXT_PLANE_API_TOKEN,
  CONTEXT_PLANE_MCP_URL: process.env.CONTEXT_PLANE_MCP_URL } : loadTeamEnvironment();
try {
  if (process.argv[2] === '--stdio') {
    const env = runtimeToken();
    const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/mcp/dist/bridge.js', import.meta.url))], {
      stdio: 'inherit', env: { ...process.env, CONTEXT_PLANE_API_TOKEN: env.CONTEXT_PLANE_API_TOKEN,
        CONTEXT_PLANE_MCP_URL: env.CONTEXT_PLANE_MCP_URL },
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.once('error', () => { console.error('TEAM_BRIDGE_FAILED'); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
  } else {
    const env = loadTeamEnvironment();
    if (process.argv.length > 2 || process.stdout.isTTY) throw new Error();
    process.stdout.write(JSON.stringify({ Authorization: `Bearer ${env.CONTEXT_PLANE_API_TOKEN}` }));
  }
} catch { console.error('TEAM_MCP_CONFIGURATION_FAILED'); process.exitCode = 1; }
