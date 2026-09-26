import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectRemote, endpoint } from './client.js';
import { implementedTools } from './domain.js';

/** Read-only by default. Write mode creates uniquely named synthetic coordination records. */
export async function verifySmoke(url: URL, token: string, options: {
  coordinationScope: string; write?: boolean;
}) {
  const health = new URL('/readyz', url);
  const unauthenticated = await fetch(health, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.equal(unauthenticated.status, 401);
  const ready = await fetch(health, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.equal(ready.status, 200);
  const status = await ready.json() as { atlas?: string; mode?: string; tools?: string[] };
  assert.equal(status.atlas, 'ready'); assert.equal(status.mode, 'shared-project-coordination');
  assert.deepEqual(status.tools?.slice().sort(), [...implementedTools].sort());
  const identity = `smoke:${randomUUID()}`; const peer = `${identity}:peer`;
  const common = { identity, scope: options.coordinationScope };
  let projectionExists = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await connectRemote(url, token);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
      assert.ok(!result.isError, `${name} failed`);
      const content = result.content[0]; assert.ok(content?.type === 'text');
      return JSON.parse(content.text);
    };
    try {
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...implementedTools].sort());
      projectionExists = (await call('get_project_context', {})).projection !== null;
      assert.equal((await call('read_operation', { operationKey: identity })).receipt, null);
      assert.equal((await client.callTool({ name: 'get_project_context', arguments: { orgId: 'other-company' } })).isError, true);
      assert.equal((await client.callTool({ name: 'get_context', arguments: { ...common, scope: `${options.coordinationScope}:forbidden` } })).isError, true);
      if (options.write && attempt === 0) {
        await call('register_agent', common);
        await call('register_agent', { ...common, identity: peer });
        await call('register_dependency', { ...common, dependency_id: identity, depends_on: peer, description: 'Synthetic smoke dependency.' });
        await call('publish_surface', { ...common, surface_name: 'deployment-smoke', kind: 'smoke_status', content: { synthetic: true } });
        const message = { ...common, message_id: identity, recipient: peer, body: 'Synthetic smoke message.' };
        assert.deepEqual(await call('send_message', message), await call('send_message', message));
        const inbox = await call('receive_inbox', { ...common, identity: peer, limit: 1, lease_seconds: 10 });
        assert.equal(inbox.messages[0]?.messageId, identity);
        const acknowledgement = { ...common, identity: peer, message_id: identity,
          lease_generation: inbox.messages[0].leaseGeneration, success: true };
        assert.deepEqual(await call('acknowledge', acknowledgement), await call('acknowledge', acknowledgement));
      }
      const context = await call('get_context', common);
      if (options.write) assert.equal(context.context.agent.identity, identity);
      else assert.equal(context.context, null);
    } finally { await client.close(); }
  }
  return { endpoint: url.origin + url.pathname, unauthorized: 'PASS', atlas: 'PASS',
    tools: implementedTools, reconnect: 'PASS', scopeOverrideRejected: 'PASS', projectionExists,
    coordinationWrites: options.write ? 'PASS' : 'NOT_RUN', mode: 'shared-project-coordination' };
}

async function main() {
  const configured = process.env.CONTEXT_PLANE_MCP_URL ?? (process.env.MCP_BASE_URL
    ? new URL('/mcp', process.env.MCP_BASE_URL).href : undefined);
  const result = await verifySmoke(endpoint(configured), process.env.CONTEXT_PLANE_API_TOKEN ?? '', {
    coordinationScope: process.env.CONTEXT_PLANE_COORDINATION_SCOPE ?? 'project:context-plane',
    write: process.env.CONTEXT_PLANE_SMOKE_WRITES === '1',
  });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch(() => { console.error('MCP_SMOKE_FAILED'); process.exitCode = 1; });
}
