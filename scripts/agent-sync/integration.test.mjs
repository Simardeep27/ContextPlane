import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../packages/mcp/dist/app.js';
import { MemoryCoordinationRepository } from '../../packages/mcp/dist/coordination.js';
import { coordinationHandlers, coordinationTools } from '../../packages/mcp/dist/domain.js';
import { connect } from './transport.mjs';
import { Outbox } from './outbox.mjs';
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';

for (const [client, { configuration, observation }] of [['Claude', claude], ['Codex', codex]]) {

test(`${client}: two independent MCP clients read reports and status after partial delivery and reconnect`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sync-http-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = new MemoryCoordinationRepository();
  const principal = { scope: { orgId: 'org_isolated', projectId: 'project_isolated' },
    identity: 'test-service', coordinationScope: 'project:context-plane', allowedTools: coordinationTools };
  const app = createApp({ token: 'isolated-test-token-only', principal, handlers: coordinationHandlers(async () => repo), ready: async () => {} });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { CONTEXT_PLANE_API_TOKEN: 'isolated-test-token-only', CONTEXT_PLANE_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp` };
  const reader = await connect(env); t.after(() => reader.close());
  await reader.call('register_agent', { identity: 'shivraj:primary', scope: principal.coordinationScope });
  const config = configuration({ CP_SYNC_IDENTITY: 'shivraj:sync', CP_SYNC_PERSON: 'Shivraj',
    CP_SYNC_INSTANCE: '411b80e3-8680-4ee7-8f25-691a24e90219', CP_SYNC_TASK: 'https://github.com/Simardeep27/ContextPlane/issues/27' }, 'isolated-session');
  const box = new Outbox(root, config);
  const input = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tool-test-1', session_id: 'isolated-session',
    tool_input: { command: 'secret command' }, tool_response: 'secret output' };
  const eventId = await box.enqueue(observation(input));
  let writer = await connect(env);
  await assert.rejects(box.flush(async (name, args) => {
    const value = await writer.call(name, args);
    if (name === 'send_message') throw Error('Simulated lost acknowledgement after stored message');
    return value;
  }));
  await writer.close(); writer = await connect(env);
  try { await new Outbox(root, config).flush(writer.call); } finally { await writer.close(); }
  const context = await reader.call('get_context', { identity: 'shivraj:primary', scope: config.scope });
  assert.equal(context.context.surfaces[0].content.lastEventId, eventId);
  assert.equal(context.context.surfaces[0].content.outcomeVerified, false);
  const inbox = await reader.call('receive_inbox', { identity: 'shivraj:primary', scope: config.scope });
  assert.equal(inbox.messages.length, 1); assert.equal(inbox.messages[0].messageId, eventId);
  assert.equal(JSON.parse(inbox.messages[0].body).evidenceKind, 'client_observation');
  assert.equal(JSON.stringify(inbox).includes('secret'), false);
  assert.equal(box.read().pending.length, 0);
  const heartbeatId = await box.enqueue({ kind: 'Heartbeat', key: 'heartbeat-test', summary: 'Process alive; outcome unverified' });
  writer = await connect(env);
  try { await box.flush(writer.call); } finally { await writer.close(); }
  const heartbeatContext = await reader.call('get_context', { identity: 'shivraj:primary', scope: config.scope });
  const heartbeat = heartbeatContext.context.surfaces[0].content;
  assert.equal(heartbeat.lastEventId, heartbeatId);
  assert.equal(heartbeat.lastActivityAt, context.context.surfaces[0].content.lastActivityAt);
  assert.equal(heartbeat.currentTask, context.context.surfaces[0].content.currentTask);
  assert.ok(heartbeat.heartbeatAt);
  const heartbeatInbox = await reader.call('receive_inbox', { identity: 'shivraj:primary', scope: config.scope });
  assert.equal(heartbeatInbox.messages.length, 1);
  assert.equal(JSON.parse(heartbeatInbox.messages[0].body).type, 'heartbeat');
});

}
