import { Container } from '@cloudflare/containers';

// Preserve the deployed class, migration, binding and instance identity.
export class BrainContainer extends Container<Env> {
  defaultPort = 8010;
  sleepAfter = '10m';
  envVars = {
    HOST: '0.0.0.0', PORT: '8010', NODE_ENV: 'production',
    MONGODB_URI: this.env.MONGODB_URI,
    MONGODB_DATABASE: this.env.MONGODB_DATABASE,
    CONTEXT_PLANE_API_TOKEN: this.env.CONTEXT_PLANE_API_TOKEN,
    CONTEXT_PLANE_ORG_ID: this.env.CONTEXT_PLANE_ORG_ID,
    CONTEXT_PLANE_PROJECT_ID: this.env.CONTEXT_PLANE_PROJECT_ID,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!['/mcp', '/readyz'].includes(url.pathname)) return new Response('Not found', { status: 404 });
    if (request.headers.has('Origin')) return new Response('Origin not allowed', { status: 403 });
    if (!env.CONTEXT_PLANE_API_TOKEN || !env.MONGODB_URI) return new Response('Service not configured', { status: 503 });
    const encoder = new TextEncoder();
    const supplied = encoder.encode(request.headers.get('Authorization') ?? '');
    const expected = encoder.encode(`Bearer ${env.CONTEXT_PLANE_API_TOKEN}`);
    if (supplied.byteLength !== expected.byteLength || !crypto.subtle.timingSafeEqual(supplied, expected)) {
      return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (Number(request.headers.get('Content-Length')) > 65536) return new Response('Request too large', { status: 413 });
    url.hostname = '127.0.0.1'; url.port = '8010'; url.protocol = 'http:';
    const headers = new Headers(request.headers);
    headers.set('Host', '127.0.0.1:8010');
    try {
      return await env.BRAIN.getByName('iteration-0').fetch(new Request(url, {
        method: request.method, headers, body: request.body, redirect: 'manual',
      }));
    } catch {
      console.error(JSON.stringify({ event: 'mcp_container_unavailable' }));
      return new Response('Service unavailable', { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
