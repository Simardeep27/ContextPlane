import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProjectScope } from '@context-plane/contracts';
import { createApp } from '../src/app.js';
import { MemoryCoordinationRepository } from '../src/coordination.js';
import { coordinationHandlers, implementedTools, readHandlers } from '../src/domain.js';

const token = 'test-token-at-least-16-characters';
const scope = { orgId: 'org_test', projectId: 'project_test' } as ProjectScope;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function start(ready: () => Promise<void> = async () => {}) {
  const repository = {
    readProjection: async () => null,
    readReceipt: async () => null,
  };
  const coordination = new MemoryCoordinationRepository(() => new Date('2026-09-26T16:00:00.000Z'));
  const app = createApp({
    token,
    principal: { scope, coordinationScope: 'project:context-plane', identity: 'test-coordinator', allowedTools: implementedTools },
    handlers: { ...readHandlers(async () => repository), ...coordinationHandlers(async () => coordination) },
    ready,
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return new URL(`http://127.0.0.1:${port}`);
}

describe('MCP HTTP service', () => {
  it('requires bearer authentication and rejects browser origins', async () => {
    const base = await start();
    assert.equal((await fetch(new URL('/readyz', base))).status, 401);
    assert.equal((await fetch(new URL('/readyz', base), {
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.test' },
    })).status, 403);
  });

  it('reports storage readiness without exposing connection details', async () => {
    const base = await start();
    const response = await fetch(new URL('/readyz', base), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      atlas: 'ready',
      service: 'context-plane',
      mode: 'shared-project-coordination',
      tools: implementedTools,
    });
  });

  it('completes the MCP handshake and exposes only implemented tools', async () => {
    const base = await start();
    const client = new Client({ name: 'context-plane-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport as unknown as Transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map(tool => tool.name), [...implementedTools]);
      const result = await client.callTool({ name: 'get_project_context', arguments: {} });
      assert.equal(result.isError, undefined);
      const content = result.content as Array<{ type: string; text: string }>;
      assert.match(content[0]!.text, /shared-project-read-only/);
    } finally {
      await client.close();
    }
  });

  it('registers agents, publishes context, and leases/acknowledges durable inbox messages', async () => {
    const base = await start();
    const client = new Client({ name: 'context-plane-coordination-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined);
      const content = result.content as Array<{ type: string; text: string }>;
      return JSON.parse(content[0]!.text) as Record<string, unknown>;
    };
    const common = { scope: 'project:context-plane' };
    try {
      await client.connect(transport as unknown as Transport);
      await call('register_agent', { ...common, identity: 'codex:nyny', metadata: { role: 'builder' } });
      await call('register_agent', { ...common, identity: 'codex:peer' });
      const dependency = await call('register_dependency', { ...common, identity: 'codex:nyny',
        dependency_id: 'mvp-03', depends_on: 'codex:peer', description: 'Needs peer verification.' });
      assert.equal(dependency.revision, 1);
      const surface = await call('publish_surface', { ...common, identity: 'codex:nyny',
        surface_name: 'codex-worklog', kind: 'work_status', content: { changedPaths: ['packages/mcp'] } });
      assert.equal(surface.revision, 1);
      await call('send_message', { ...common, identity: 'codex:nyny', message_id: 'message-001',
        recipient: 'codex:peer', body: 'Please verify the MCP catalog.', evidence_ids: ['evidence-001'] });
      const firstInbox = await call('receive_inbox', { ...common, identity: 'codex:peer', lease_seconds: 60 });
      const firstMessage = (firstInbox.messages as Array<Record<string, unknown>>)[0]!;
      assert.equal(firstMessage.leaseGeneration, 1);
      await call('acknowledge', { ...common, identity: 'codex:peer', message_id: 'message-001',
        lease_generation: 1, success: false });
      const retriedInbox = await call('receive_inbox', { ...common, identity: 'codex:peer', lease_seconds: 60 });
      const retriedMessage = (retriedInbox.messages as Array<Record<string, unknown>>)[0]!;
      assert.equal(retriedMessage.leaseGeneration, 2);
      await call('acknowledge', { ...common, identity: 'codex:peer', message_id: 'message-001',
        lease_generation: 2, success: true });
      const emptyInbox = await call('receive_inbox', { ...common, identity: 'codex:peer' });
      assert.deepEqual(emptyInbox.messages, []);
      const context = await call('get_context', { ...common, identity: 'codex:nyny' });
      const value = context.context as Record<string, unknown>;
      assert.equal((value.dependencies as unknown[]).length, 1);
      assert.equal((value.surfaces as unknown[]).length, 1);
      const wrongScope = await client.callTool({ name: 'get_context',
        arguments: { identity: 'codex:nyny', scope: 'project:elsewhere' } });
      assert.equal(wrongScope.isError, true);
      assert.equal((wrongScope.content as Array<{ text: string }>)[0]?.text, 'INVALID_INPUT');
    } finally {
      await client.close();
    }
  });

  it('returns a bounded unavailable response when storage is down', async () => {
    const base = await start(async () => { throw new Error('secret connection detail'); });
    const response = await fetch(new URL('/readyz', base), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { atlas: 'unavailable', code: 'STORAGE_UNAVAILABLE' });
  });
});
