import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../../packages/mcp/dist/app.js';
import { MemoryCoordinationRepository } from '../../packages/mcp/dist/coordination.js';
import { MemoryBrainRepository } from '../../packages/mcp/dist/brain.js';
import { brainHandlers, coordinationHandlers, implementedTools } from '../../packages/mcp/dist/domain.js';
import { connect } from '../agent-sync/transport.mjs';
import { parsePrinciples, seed } from './seed-principles.mjs';

const markdown = readFileSync(new URL('../../docs/COMPANY_BRAIN.md', import.meta.url), 'utf8');

test('COMPANY_BRAIN.md stays short and defines 5-7 cited principles', () => {
  assert.ok(markdown.trimEnd().split('\n').length < 60);
  const principles = parsePrinciples(markdown);
  assert.ok(principles.length >= 5 && principles.length <= 7);
  assert.ok(principles.every(p => p.entryId.startsWith('principle:') && p.sourceIds[0].startsWith('docs/')));
  assert.ok(principles.some(p => p.title === 'Verified over reported'));
});

test('seed loads principles through MCP remember idempotently and only for a registered primary', async t => {
  const coordination = new MemoryCoordinationRepository(); const brain = new MemoryBrainRepository();
  const scope = 'project:context-plane'; const token = 'isolated-seed-token-only';
  const app = createApp({ token, ready: async () => {},
    principal: { scope: { orgId: 'org_isolated', projectId: 'project_isolated' }, identity: 'test', coordinationScope: scope,
      allowedTools: implementedTools },
    handlers: { ...coordinationHandlers(async () => coordination, async () => brain), ...brainHandlers(async () => coordination, async () => brain) } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const mcp = await connect({ CONTEXT_PLANE_API_TOKEN: token, CONTEXT_PLANE_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp` });
  t.after(() => mcp.close());
  const principles = parsePrinciples(markdown);
  await assert.rejects(seed(mcp, 'shivraj:primary', scope, principles), /AGENT_NOT_REGISTERED/);
  await mcp.call('register_agent', { identity: 'shivraj:primary', scope });
  const first = await seed(mcp, 'shivraj:primary', scope, principles);
  assert.deepEqual(await seed(mcp, 'shivraj:primary', scope, principles), first);
  assert.equal(brain.entries.size, principles.length);
  const context = await mcp.call('get_context', { identity: 'shivraj:primary', scope });
  assert.equal(context.brain.principles.length, principles.length);
});
