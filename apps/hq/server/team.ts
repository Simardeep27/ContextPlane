import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { projectLedger, projectTeam } from '../shared/team.js';
const endpoint = 'https://context-plane-brain.buddhsen-work.workers.dev/mcp';
const cookieName = 'hq_team_session';
const sessionSeconds = 8 * 60 * 60;
type Env = { CONTEXT_PLANE_API_TOKEN?: string; HQ_VIEW_PASSWORD?: string; VERCEL?: string };
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function signature(expires: string, key: string) { return createHmac('sha256', key).update(`hq-team:${expires}`).digest('hex'); }
function validSession(cookie: string, key: string, now: number) {
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
  const [expires = '', sig = ''] = value.split('.');
  const expiry = Number(expires);
  return /^\d+$/.test(expires) && expiry > now && expiry <= now + sessionSeconds * 1000 && equal(sig, signature(expires,key));
}
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
  // read_ledger is newer than the deployed MCP may be; the team view still works without it.
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return { ...team, events: projectLedger(await callTool(token, fetcher, 'read_ledger', { ...scopeArgs, since, limit: 200 })), eventsAvailable: true };
  } catch { return { ...team, events: [], eventsAvailable: false }; }
}
export function createTeamHandler(env: Env, fetcher: typeof fetch = fetch, clock = Date.now) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control':'private, no-store', 'Vary':'Cookie', 'X-Content-Type-Options':'nosniff' });
    const json = (status: number, body: unknown) => Response.json(body, { status, headers });
    const password = env.HQ_VIEW_PASSWORD;
    // Independent access gate: never rely on a client-supplied Vercel header.
    if (!password || password.length < 24 || !env.CONTEXT_PLANE_API_TOKEN || equal(password, env.CONTEXT_PLANE_API_TOKEN)) return json(503, {error:'TEAM_NOT_CONFIGURED'});
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    if (req.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== url.origin) return json(403, {error:'ORIGIN_FORBIDDEN'});
    const secure = env.VERCEL || url.protocol === 'https:' ? '; Secure' : '';
    const cookie = (value: string, age: number) => `${cookieName}=${value}; Path=/api/team; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
    if (req.method === 'POST') {
      if (!origin || req.headers.get('content-type')?.split(';')[0] !== 'application/json') return json(403, {error:'ORIGIN_REQUIRED'});
      try {
        // Bound bytes before JSON parsing; do not log passwords or upstream payloads.
        const reader = req.body?.getReader(); if (!reader) return json(400,{error:'INVALID_BODY'});
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > 4096) { await reader.cancel(); return json(413,{error:'INVALID_BODY'}); } chunks.push(part.value); }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body.password !== 'string' || !equal(body.password,password)) return json(401,{error:'SIGN_IN_REQUIRED'});
        const expires = String(clock() + sessionSeconds * 1000);
        headers.set('Set-Cookie',cookie(`${expires}.${signature(expires,password)}`,sessionSeconds));
        return json(200,{ok:true});
      } catch { return json(400,{error:'INVALID_BODY'}); }
    }
    if (req.method === 'DELETE') {
      if (!origin) return json(403,{error:'ORIGIN_REQUIRED'});
      headers.set('Set-Cookie',cookie('',0)); return json(200,{ok:true});
    }
    if (req.method !== 'GET') { headers.set('Allow','GET, POST, DELETE'); return json(405,{error:'METHOD_NOT_ALLOWED'}); }
    if (!validSession(req.headers.get('cookie') ?? '',password,clock())) return json(401,{error:'SIGN_IN_REQUIRED'});
    try { return json(200,await readTeam(env.CONTEXT_PLANE_API_TOKEN,fetcher)); }
    catch { return json(502,{error:'TEAM_UNAVAILABLE'}); }
  };
}
