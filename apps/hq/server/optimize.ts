// Serverless wrapper around Simar's harness prompt optimizer (apps/api/src/harness-optimize.ts).
// Shared by import, not copied, so the Vercel function needs no local :3001 API.
import { optimizeHarnessPrompt, parseHarnessOptimizeInput } from '../../api/src/harness-optimize.js';
export function createOptimizeHandler() {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    const json = (status: number, body: unknown) => Response.json(body, { status, headers });
    const url = new URL(req.url); const origin = req.headers.get('origin');
    if (req.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== url.origin) return json(403, {error:'ORIGIN_FORBIDDEN'});
    if (req.method !== 'POST') { headers.set('Allow','POST'); return json(405,{error:'METHOD_NOT_ALLOWED'}); }
    if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') return json(415,{error:'INVALID_INPUT'});
    const text = await req.text();
    if (text.length > 16_384) return json(413,{error:'INVALID_INPUT'});
    try { return json(200, optimizeHarnessPrompt(parseHarnessOptimizeInput(JSON.parse(text)))); }
    catch { return json(400,{error:'INVALID_INPUT'}); }
  };
}
