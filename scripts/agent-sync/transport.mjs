import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export async function connect(env = process.env) {
  const url = new URL(env.CONTEXT_PLANE_MCP_URL ?? 'https://context-plane-brain.buddhsen-work.workers.dev/mcp');
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('INVALID_ENDPOINT');
  const token = env.CONTEXT_PLANE_API_TOKEN;
  if (!token || token.length < 16) throw Error('MISSING_TOKEN');
  const client = new Client({ name: 'context-plane-agent-sync', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }),
  });
  try { await client.connect(transport, { timeout: 5000 }); }
  catch { await transport.close().catch(() => {}); throw Error('MCP_UNAVAILABLE'); }
  return { close: () => client.close(), call: async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
    if (result.isError || result.content?.[0]?.type !== 'text') throw Error('MCP_DELIVERY_FAILED');
    return JSON.parse(result.content[0].text);
  } };
}
