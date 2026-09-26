import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { applyDistillation, distill, fromLedgerEvent, type BrainEntryLike, type BrainWriter, type LedgerEventLike } from '../shared/distill-core.mjs';

// Vercel Cron steward (issue #54). Reads the ledger through the hosted MCP, distills
// deterministic episodes and insights, and appends them through `remember`. The MCP
// token stays server-side; the cron secret only gates this endpoint.
const endpoint = 'https://context-plane-brain.buddhsen-work.workers.dev/mcp';
export const STEWARD_IDENTITY = 'company:steward';
const SCOPE = 'project:context-plane';
const MAX_WRITES = 40;
type Env = { CRON_SECRET?: string; CONTEXT_PLANE_API_TOKEN?: string };

export class McpToolError extends Error { constructor(readonly code: string) { super(code); } }

async function callTool(token: string, fetcher: typeof fetch, name: string, args: Record<string, unknown>) {
  const id = randomUUID();
  const upstream = await fetcher(endpoint, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(10_000) });
  if (!upstream.ok) throw new McpToolError('MCP_UNAVAILABLE');
  const envelope = await upstream.json();
  if (envelope.id !== id || envelope.error) throw new McpToolError('MCP_UNAVAILABLE');
  const result = envelope.result;
  const text = result?.content?.find((c: { type: string }) => c.type === 'text')?.text;
  if (result?.isError) throw new McpToolError(typeof text === 'string' && /^[A-Z_]{1,64}$/.test(text) ? text : 'MCP_TOOL_ERROR');
  return result?.structuredContent ?? JSON.parse(text ?? 'null');
}

/** Constant-time bearer check; an unset secret rejects every request. */
export function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** Brain writer over MCP recall/remember. `recall` returns active, non-superseded entries, which is what supersession needs. */
export function mcpBrain(call: (name: string, args: Record<string, unknown>) => Promise<any>): BrainWriter {
  let active: Promise<BrainEntryLike[]> | undefined;
  const base = { identity: STEWARD_IDENTITY, scope: SCOPE };
  return {
    async listByPrefix(_scope, prefix) {
      active ??= Promise.all(['episode', 'insight'].map(kind => call('recall', { ...base, kinds: [kind], limit: 50 })))
        .then(results => results.flatMap(result => Array.isArray(result?.entries) ? result.entries : []));
      return (await active).filter(entry => typeof entry.entryId === 'string' && entry.entryId.startsWith(prefix));
    },
    async remember(input) {
      try {
        await call('remember', { ...base, kind: input.kind, title: input.title, body: input.body, source_ids: input.sourceIds,
          entry_id: input.entryId, ...(input.supersedes ? { supersedes: input.supersedes } : {}) });
      } catch (error) {
        // Same entryId already stored (older than the recall window): content-addressed, so it is unchanged.
        if (!(error instanceof McpToolError && error.code === 'IDEMPOTENCY_CONFLICT')) throw error;
      }
    },
  };
}

export async function runSteward(token: string, fetcher: typeof fetch = fetch, now = new Date()) {
  const call = (name: string, args: Record<string, unknown>) => callTool(token, fetcher, name, args);
  await call('register_agent', { identity: STEWARD_IDENTITY, scope: SCOPE, metadata: { role: 'steward', runtime: 'vercel-cron' } });
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ledger = await call('read_ledger', { identity: STEWARD_IDENTITY, scope: SCOPE, since, limit: 200 });
  const events: LedgerEventLike[] = Array.isArray(ledger?.events) ? ledger.events : [];
  // Heartbeats are liveness, not work: excluding them keeps episodes stable between runs.
  const messages = events.filter(event => event.type !== 'heartbeat').map(fromLedgerEvent);
  const derived = distill(messages).slice(0, MAX_WRITES);
  const summary = await applyDistillation(mcpBrain(call), SCOPE, STEWARD_IDENTITY, derived);
  return { event: 'steward_distilled', messages: messages.length, derived: derived.length, ...summary };
}

export function createStewardHandler(env: Env, fetcher: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const json = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (!authorized(req.headers.get('authorization'), env.CRON_SECRET)) return json(401, { error: 'UNAUTHORIZED' });
    if (req.method !== 'GET') { headers.set('Allow', 'GET'); return json(405, { error: 'METHOD_NOT_ALLOWED' }); }
    if (!env.CONTEXT_PLANE_API_TOKEN) return json(503, { error: 'STEWARD_NOT_CONFIGURED' });
    try { return json(200, await runSteward(env.CONTEXT_PLANE_API_TOKEN, fetcher)); }
    catch (error) { return json(502, { error: error instanceof McpToolError ? error.code : 'STEWARD_FAILED' }); }
  };
}
