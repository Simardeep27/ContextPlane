import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDomainServer, implementedTools, type DomainHandlers, type Principal } from './domain.js';

export interface AppOptions {
  token: string;
  principal: Principal;
  handlers: DomainHandlers;
  ready: () => Promise<void>;
}
export function createApp(options: AppOptions) {
  if (options.token.length < 16) throw new Error('MCP_TOKEN_NOT_CONFIGURED');
  const app = express(); app.disable('x-powered-by');
  app.use(hostHeaderValidation(['127.0.0.1', 'localhost', '[::1]']));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['/mcp', '/readyz'].includes(req.path)) { res.status(404).end(); return; }
    // Native MCP clients do not send Origin; browser embedding is not supported.
    if (req.headers.origin !== undefined) { res.status(403).send('Origin not allowed'); return; }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from('Bearer ' + options.token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).send('Unauthorized'); return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await options.ready();
      res.json({ atlas: 'ready', service: 'context-plane', mode: 'shared-project-read-only', tools: implementedTools });
    } catch { res.status(503).json({ atlas: 'unavailable', code: 'STORAGE_UNAVAILABLE' }); }
  });
  app.post('/mcp', async (req, res) => {
    const server = createDomainServer(options.principal, options.handlers);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null,
        error: { code: -32603, message: 'SERVICE_UNAVAILABLE' } });
      else res.end();
    }
  });
  app.all('/mcp', (_req, res) => { res.set('Allow', 'POST').status(405).end(); });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 400;
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST' });
  };
  app.use(errors);
  return app;
}
