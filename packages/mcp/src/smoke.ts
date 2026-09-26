import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

function setting(name: string): string {
  const value = process.env[name];
  if (!value || value.length > 2048) throw new Error(`MISSING_${name}`);
  return value;
}

async function main() {
  const baseUrl = new URL(setting('MCP_BASE_URL'));
  const token = setting('CONTEXT_PLANE_API_TOKEN');
  const headers = { Authorization: `Bearer ${token}` };

  const ready = await fetch(new URL('/readyz', baseUrl), { headers });
  if (!ready.ok) throw new Error(`READINESS_${ready.status}`);
  const status = await ready.json() as { service?: string; atlas?: string };
  if (status.service !== 'context-plane' || status.atlas !== 'ready') throw new Error('INVALID_READINESS');

  const client = new Client({ name: 'context-plane-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), { requestInit: { headers } });
  try {
    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    const names = tools.tools.map(tool => tool.name).sort();
    if (names.join(',') !== 'get_project_context,read_operation') throw new Error('UNEXPECTED_TOOL_CATALOG');
    const context = await client.callTool({ name: 'get_project_context', arguments: {} });
    if (context.isError) throw new Error('CONTEXT_READ_FAILED');
    console.log(JSON.stringify({ event: 'mcp_smoke_passed', tools: names }));
  } finally {
    await client.close();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'SMOKE_FAILED');
  process.exitCode = 1;
});
