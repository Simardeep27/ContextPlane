import { randomUUID } from 'node:crypto';
import { projectLedger, projectTeam } from '../shared/team.js';
const endpoint = 'https://context-plane-brain.buddhsen-work.workers.dev/mcp';
type Env = { CONTEXT_PLANE_API_TOKEN?: string };
async function callTool(token: string, fetcher: typeof fetch, name: string, args: Record<string, unknown>) {
  const id = randomUUID();
  const upstream = await fetcher(endpoint, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc:'2.0', id, method:'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(10_000) });
  if (!upstream.ok) throw new Error('MCP_UNAVAILABLE');
  const envelope = await upstream.json();
  if (envelope.id !== id || envelope.error || envelope.result?.isError) throw new Error('MCP_UNAVAILABLE');
  const result = envelope.result;
  return result.structuredContent ?? JSON.parse(result.content?.find((c: {type: string}) => c.type === 'text')?.text ?? 'null');
}
const scopeArgs = { identity:'shivraj:ui', scope:'project:context-plane' };
export async function readTeam(token: string, fetcher: typeof fetch = fetch) {
  const team = projectTeam(await callTool(token, fetcher, 'get_context', scopeArgs));
  if (team.events.length) return team;
  // read_ledger is newer than the deployed MCP may be; without it the view keeps the context events.
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return { ...team, events: projectLedger(await callTool(token, fetcher, 'read_ledger', { ...scopeArgs, since, limit: 200 })) };
  } catch { return team; }
}
export function createTeamHandler(env: Env, fetcher: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    const json = (status: number, body: unknown) => Response.json(body, { status, headers });
    // Open read-only view (no viewer login). The MCP token stays server-side; only the
    // allowlisted projection is returned, never raw bodies, tokens or URIs.
    if (!env.CONTEXT_PLANE_API_TOKEN) return json(503, {error:'TEAM_NOT_CONFIGURED'});
    const url = new URL(req.url); const origin = req.headers.get('origin');
    if (req.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== url.origin) return json(403, {error:'ORIGIN_FORBIDDEN'});
    if (req.method !== 'GET') { headers.set('Allow','GET'); return json(405,{error:'METHOD_NOT_ALLOWED'}); }
    try { return json(200,await readTeam(env.CONTEXT_PLANE_API_TOKEN,fetcher)); }
    catch { return json(502,{error:'TEAM_UNAVAILABLE'}); }
  };
}
