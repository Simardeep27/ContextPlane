import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const defaultEndpoint = 'https://context-plane-brain.buddhsen-work.workers.dev/mcp';
export function endpoint(value = process.env.CONTEXT_PLANE_MCP_URL ?? defaultEndpoint): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('INVALID_MCP_ENDPOINT');
  }
  return url;
}
export async function connectRemote(url: URL, token: string) {
  if (!token || token.length < 16) throw new Error('MCP_TOKEN_NOT_CONFIGURED');
  const client = new Client({ name: 'context-plane-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error',
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) }),
  });
  try { await client.connect(transport, { timeout: 120_000 }); return client; }
  catch { await transport.close().catch(() => {}); throw new Error('MCP_CONNECTION_FAILED'); }
}
