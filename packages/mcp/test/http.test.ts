import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, it } from 'node:test';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ProjectScope } from '@context-plane/contracts';
import { blockedResumedCompletedEvents, blockedResumedCompletedProjections } from '@context-plane/contracts/fixtures';
import { DurablePersistenceAdapter, MemoryStorage } from '@context-plane/persistence';
import { createApp } from '../src/app.js';
import { implementedTools, readHandlers } from '../src/domain.js';
import { connectRemote, endpoint } from '../src/client.js';

const token = 'fixture-token-no-production-access';
const scope = blockedResumedCompletedProjections[0].scope;
const repository = new DurablePersistenceAdapter(new MemoryStorage());
let listener: HttpServer; let url: URL; let ready = true; let storageFailure = false;
before(async () => {
  for (const event of blockedResumedCompletedEvents) await repository.appendEvent(event);
  await repository.saveProjection(blockedResumedCompletedProjections[2], 0);
  const app = createApp({ token, principal: { scope, identity: 'fixture-reader', allowedTools: implementedTools },
    handlers: readHandlers(async () => { if (storageFailure) throw new Error('secret-connection-details'); return repository; }),
    ready: async () => { if (!ready) throw new Error('secret-connection-details'); },
  });
  listener = app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  url = new URL(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`);
});
after(async () => { if (listener?.listening) await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); });
async function withClient(action: (client: Awaited<ReturnType<typeof connectRemote>>) => Promise<void>) {
  const client = await connectRemote(url, token); try { await action(client); } finally { await client.close(); }
}
it('bridges stdio discovery and reads to the HTTP server', async () => {
  const client = new Client({ name: 'bridge-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/bridge.ts', import.meta.url))],
    env: { CONTEXT_PLANE_API_TOKEN: token, CONTEXT_PLANE_MCP_URL: url.href },
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), [...implementedTools]);
    const result = await client.callTool({ name: 'get_project_context', arguments: {} });
    assert.ok(!result.isError);
  } finally { await client.close(); }
});
it('requires bearer auth for health and protocol traffic', async () => {
  for (const path of ['/mcp', '/readyz']) {
    assert.equal((await fetch(new URL(path, url))).status, 401);
    assert.equal((await fetch(new URL(path, url), { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  }
});
it('rejects untrusted Host and Origin headers', async () => {
  const headers = { Authorization: 'Bearer ' + token };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    httpRequest(url, { headers: { ...headers, Host: 'untrusted.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject).end();
  });
  assert.equal(status, 403);
});
it('discovers only implemented contract tools and reads actual stored projection', async () => withClient(async client => {
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name), [...implementedTools]);
  assert.ok(tools.every(tool => tool.annotations?.readOnlyHint));
  const result = await client.callTool({ name: 'get_project_context', arguments: {} });
  assert.ok(!result.isError);
  const content = result.content as { type: string; text: string }[];
  assert.deepEqual(JSON.parse(content[0]!.text).projection, blockedResumedCompletedProjections[2]);
}));
it('rejects caller-supplied scope, identity and undeclared tool arguments', async () => withClient(async client => {
  for (const args of [{ orgId: 'another' }, { agentId: 'another' }, { scope: { orgId: 'other', projectId: 'other' } }]) {
    assert.equal((await client.callTool({ name: 'get_project_context', arguments: args })).isError, true);
  }
  assert.equal((await client.callTool({ name: 'read_operation', arguments: {} })).isError, true);
}));
it('does not expose legacy tools, write tools, or admin commands', async () => withClient(async client => {
  for (const name of ['publish_surface', 'session_event', 'apply_change', 'approve_access', 'promote_rule']) {
    assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
  }
}));
it('can initialize and list tools while Atlas is unavailable; failures are sanitized', async () => {
  ready = false; storageFailure = true;
  try {
    const response = await fetch(new URL('/readyz', url), { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('secret-connection-details'));
    await withClient(async client => {
      assert.equal((await client.listTools()).tools.length, 2);
      const result = await client.callTool({ name: 'get_project_context', arguments: {} });
      assert.equal(result.isError, true); assert.ok(!JSON.stringify(result).includes('secret-connection-details'));
    });
  } finally { ready = true; storageFailure = false; }
});
it('reports missing receipts and reconnects without creating state', async () => {
  const before = await repository.readEvents(scope);
  for (let i = 0; i < 2; i++) await withClient(async client => {
    const result = await client.callTool({ name: 'read_operation', arguments: { operationKey: 'missing' } });
    assert.ok(!result.isError);
    const content = result.content as { text: string }[];
    assert.equal(JSON.parse(content[0]!.text).receipt, null);
  });
  assert.deepEqual(await repository.readEvents(scope), before);
});
it('does not return another project even when it has records', async () => {
  const other = { ...scope, projectId: 'other' } as ProjectScope;
  await repository.appendEvent({ ...blockedResumedCompletedEvents[0], scope: other });
  await repository.saveProjection({ ...blockedResumedCompletedProjections[0], scope: other }, 0);
  await withClient(async client => {
    const result = await client.callTool({ name: 'get_project_context', arguments: {} });
    const content = result.content as { text: string }[];
    assert.equal(JSON.parse(content[0]!.text).projection.scope.projectId, scope.projectId);
  });
});
it('bounds JSON body size, sanitizes parse errors and rejects unsupported methods', async () => {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const huge = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ huge: 'x'.repeat(70_000) }) });
  assert.equal(huge.status, 413);
  const malformed = await fetch(url, { method: 'POST', headers, body: '{secret-parser-detail' });
  assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes('secret-parser-detail'));
  assert.equal((await fetch(url, { headers })).status, 405);
});
it('rejects insecure remote endpoints and embedded credentials', () => {
  assert.throws(() => endpoint('http://example.com/mcp'));
  assert.throws(() => endpoint('https://user:password@example.com/mcp'));
  assert.equal(endpoint('http://127.0.0.1:8010/mcp').protocol, 'http:');
});
