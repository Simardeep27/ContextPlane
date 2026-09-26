import assert from 'node:assert/strict';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectRemote, endpoint } from './client.js';
import { implementedTools } from './domain.js';

async function main() {
  const url = endpoint(); const token = process.env.CONTEXT_PLANE_API_TOKEN ?? '';
  const health = new URL('/readyz', url);
  const unauthenticated = await fetch(health, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.equal(unauthenticated.status, 401);
  const ready = await fetch(health, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.equal(ready.status, 200);
  const status = await ready.json() as { atlas?: string; mode?: string };
  assert.equal(status.atlas, 'ready'); assert.equal(status.mode, 'shared-project-read-only');
  let projectionExists = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await connectRemote(url, token);
    try {
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...implementedTools].sort());
      const context = CallToolResultSchema.parse(await client.callTool({ name: 'get_project_context', arguments: {} }));
      assert.ok(!context.isError);
      const content = context.content[0]; assert.ok(content?.type === 'text');
      const result = JSON.parse(content.text) as { projection: unknown; mode: string };
      assert.equal(result.mode, 'shared-project-read-only'); projectionExists = result.projection !== null;
      const receipt = CallToolResultSchema.parse(await client.callTool({ name: 'read_operation', arguments: { operationKey: '__mcp_smoke_missing__' } }));
      assert.ok(!receipt.isError); assert.ok(receipt.content[0]?.type === 'text');
      assert.equal(JSON.parse(receipt.content[0].text).receipt, null);
      const denied = await client.callTool({ name: 'get_project_context', arguments: { orgId: 'other-company' } });
      assert.equal(denied.isError, true);
    } finally { await client.close(); }
  }
  console.log(JSON.stringify({ endpoint: url.origin + url.pathname, unauthorized: 'PASS', atlas: 'PASS',
    tools: implementedTools, reconnect: 'PASS', scopeOverrideRejected: 'PASS', projectionExists,
    mode: 'shared-project-read-only' }, null, 2));
}
void main().catch(() => { console.error('MCP_SMOKE_FAILED'); process.exitCode = 1; });
