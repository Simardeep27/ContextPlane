import { createServer, type IncomingMessage } from 'node:http';
import type { Command, Harness } from './harness.js';
import { HarnessError, plain, requireThat } from './validation.js';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk); requireThat(Buffer.byteLength(text) <= 32768, 'REQUEST_TOO_LARGE', 413);
  }
  let value: unknown;
  try { value = JSON.parse(text || '{}'); } catch { throw new HarnessError('INVALID_JSON', 400); }
  plain(value); requireThat(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 400);
  return value as Record<string, unknown>;
}
/** Loopback JSON transport, deliberately not advertised as MCP. No model calls. */
export function createGatewayServer(harness: Harness) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
    try {
      requireThat(req.headers.origin === undefined, 'ORIGIN_FORBIDDEN', 403);
      requireThat(/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? ''), 'HOST_FORBIDDEN', 403);
      const auth = req.headers.authorization; requireThat(typeof auth === 'string' && auth.startsWith('Bearer '), 'UNAUTHORIZED', 401);
      const token = auth.slice(7); const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      let result: unknown;
      if (req.method === 'GET' && path === '/context') result = await harness.context(token);
      else if (req.method === 'POST' && path === '/commands') {
        const data = await body(req); requireThat(!Object.hasOwn(data, 'token'), 'INVALID_INPUT', 400);
        result = await harness.execute({ ...data, token } as unknown as Command);
      } else if (req.method === 'GET' && path === '/controller/state') result = await harness.controllerState(token);
      else if (req.method === 'POST' && (path === '/controller/diagnose' || path === '/controller/learn')) {
        const data = await body(req); requireThat(Object.keys(data).length === 1 && typeof data.operationKey === 'string', 'INVALID_INPUT', 400);
        result = path.endsWith('diagnose') ? await harness.diagnoseFailure(token, data.operationKey) : await harness.learnFromFailure(token, data.operationKey);
      } else throw new HarnessError('NOT_FOUND', 404);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (error) {
      const known = error instanceof HarnessError || (error && typeof error === 'object' && 'code' in error);
      res.writeHead(error instanceof HarnessError ? error.status : known ? 409 : 500);
      res.end(JSON.stringify({ error: known ? (error as { code: string }).code : 'INTERNAL_ERROR' }));
    }
  });
}
