import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectRemote, endpoint } from './client.js';

/** Stdio credentials arrive from the launching process; stdout is MCP only. */
async function main() {
  const remote = await connectRemote(endpoint(), process.env.CONTEXT_PLANE_API_TOKEN ?? '');
  const server = new Server({ name: 'context-plane-bridge', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try { return await remote.listTools(); }
    catch { throw new Error('MCP_CONNECTION_FAILED'); }
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try { return CallToolResultSchema.parse(await remote.callTool(request.params, CallToolResultSchema, { timeout: 120_000 })); }
    catch { return { isError: true, content: [{ type: 'text', text: 'MCP_CONNECTION_FAILED' }] }; }
  });
  const transport = new StdioServerTransport();
  server.onclose = () => { void remote.close().finally(() => process.exit(0)); };
  await server.connect(transport);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void Promise.allSettled([server.close(), remote.close()]).finally(() => process.exit(0));
  });
}
void main().catch(() => { console.error('MCP_CONNECTION_FAILED'); process.exitCode = 1; });
