import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorized, createStewardHandler, runSteward, STEWARD_IDENTITY } from './steward.ts';
import { projectInsights } from '../shared/team.ts';

const secret = 'test-only-cron-secret';
const env = { CRON_SECRET: secret, CONTEXT_PLANE_API_TOKEN: 'test-only-upstream-token' };
const request = (headers: Record<string, string> = {}, method = 'GET') => new Request('https://hq.example/api/steward', { method, headers });

test('steward rejects missing, wrong and unconfigured bearer secrets before any upstream call', async () => {
  let calls = 0; const upstream: typeof fetch = async () => { calls++; throw Error('should not run'); };
  const handle = createStewardHandler(env, upstream);
  for (const headers of <Record<string, string>[]>[{}, { authorization: 'Bearer wrong' }, { authorization: secret }, { authorization: `Bearer ${secret}x` }]) {
    const response = await handle(request(headers));
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
  }
  assert.equal((await createStewardHandler({ ...env, CRON_SECRET: undefined }, upstream)(request({ authorization: 'Bearer undefined' }))).status, 401);
  assert.equal((await createStewardHandler({ ...env, CRON_SECRET: '' }, upstream)(request({ authorization: 'Bearer ' }))).status, 401);
  assert.equal((await handle(request({ authorization: `Bearer ${secret}` }, 'POST'))).status, 405);
  assert.equal(calls, 0);
  assert.equal(authorized(`Bearer ${secret}`, secret), true);
});

type Entry = { entryId: string; kind: string; title: string; body: string; supersedes?: string; author: string; createdAt: string };
function fakeMcp(events: unknown[]) {
  const entries = new Map<string, Entry>(); const tools: string[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    const { id, params: { name, arguments: args } } = JSON.parse(String(options?.body));
    tools.push(name);
    assert.equal(args.identity, STEWARD_IDENTITY);
    const reply = (value: unknown) => Response.json({ id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
    if (name === 'register_agent' || name === 'read_ledger') return reply(name === 'read_ledger' ? { events } : {});
    if (name === 'recall') {
      const superseded = new Set([...entries.values()].map(e => e.supersedes));
      return reply({ entries: [...entries.values()].filter(e => args.kinds.includes(e.kind) && !superseded.has(e.entryId)) });
    }
    if (name === 'remember') {
      const existing = entries.get(args.entry_id);
      if (existing) return reply(existing);
      entries.set(args.entry_id, { entryId: args.entry_id, kind: args.kind, title: args.title, body: args.body,
        author: args.identity, createdAt: new Date().toISOString(), ...(args.supersedes ? { supersedes: args.supersedes } : {}) });
      return reply(entries.get(args.entry_id));
    }
    throw Error(`unexpected tool ${name}`);
  };
  return { entries, tools, fetcher };
}
const ledger = (messageId: string, senderIdentity: string, type: string, createdAt: string, files: string[] = []) =>
  ({ messageId, senderIdentity, createdAt, type, summary: `${type} by ${senderIdentity}`, task: 'issue #54', files });

test('steward distills ledger through MCP idempotently and supersedes changed episodes', async () => {
  const events = [ledger('s1', 'simar:primary', 'work_started', '2026-09-26T10:00:00Z', ['a.ts']),
    ledger('b1', 'buddh:primary', 'work_started', '2026-09-26T10:10:00Z', ['a.ts']),
    ledger('hb', 'simar:primary', 'heartbeat', '2026-09-26T10:11:00Z'),
    ledger('s2', 'simar:primary', 'work_finished', '2026-09-26T10:20:00Z')];
  const mcp = fakeMcp(events);
  const now = new Date('2026-09-26T12:00:00Z');
  const first = await runSteward('token', mcp.fetcher, now);
  assert.deepEqual({ created: first.created, unchanged: first.unchanged, superseding: first.superseding, messages: first.messages },
    { created: 4, unchanged: 0, superseding: 0, messages: 3 });
  assert.ok([...mcp.entries.values()].every(entry => entry.author === STEWARD_IDENTITY));
  assert.ok([...mcp.entries.values()].some(entry => entry.title.startsWith('Possible collision')));
  assert.ok(![...mcp.entries.values()].some(entry => entry.body.includes('[hb]')), 'heartbeats are excluded');
  const size = mcp.entries.size;
  const second = await runSteward('token', mcp.fetcher, now);
  assert.deepEqual([second.created, second.unchanged], [0, 4]);
  assert.equal(mcp.entries.size, size);
  events.push(ledger('b2', 'buddh:primary', 'work_finished', '2026-09-26T10:40:00Z'));
  const third = await runSteward('token', mcp.fetcher, now);
  assert.equal(third.superseding, 2); // buddh's episode and the day's finished insight changed
  assert.equal(mcp.tools.filter(tool => tool === 'register_agent').length, 3);
});

test('steward handler returns a summary for the cron secret and hides upstream errors', async () => {
  const ok = await createStewardHandler(env, fakeMcp([]).fetcher)(request({ authorization: `Bearer ${secret}` }));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).event, 'steward_distilled');
  const failed = await createStewardHandler(env, async () => { throw Error(env.CONTEXT_PLANE_API_TOKEN); })(request({ authorization: `Bearer ${secret}` }));
  assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes(env.CONTEXT_PLANE_API_TOKEN));
});

test('team insights projection keeps only title, author and time', () => {
  assert.deepEqual(projectInsights({ insights: [{ title: 'Possible collision', author: STEWARD_IDENTITY, createdAt: '2026-09-26T10:00:00Z',
    body: 'secret body', sourceIds: ['x'] }, { title: '' }] }),
  [{ title: 'Possible collision', author: STEWARD_IDENTITY, createdAt: '2026-09-26T10:00:00.000Z' }]);
  assert.deepEqual(projectInsights(undefined), []);
});
