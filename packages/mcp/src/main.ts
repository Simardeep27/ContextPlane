import type { ProjectScope } from '@context-plane/contracts';
import { connectStorage, DurablePersistenceAdapter } from '@context-plane/persistence';
import { createApp } from './app.js';
import { implementedTools, readHandlers } from './domain.js';

function setting(name: string): string {
  const value = process.env[name];
  if (!value || value.length > 256) throw new Error('MISSING_RUNTIME_SETTING');
  return value;
}
async function main() {
  const scope = { orgId: setting('CONTEXT_PLANE_ORG_ID'), projectId: setting('CONTEXT_PLANE_PROJECT_ID') } as ProjectScope;
  const database = setting('MONGODB_DATABASE');
  const token = setting('CONTEXT_PLANE_API_TOKEN');
  let pending: Promise<Awaited<ReturnType<typeof connectStorage>>> | undefined;
  const connection = () => {
    // Cache only successful connections, and retry after an unavailable Atlas.
    pending ??= connectStorage(database).catch(error => { pending = undefined; throw error; });
    return pending;
  };
  let repository: DurablePersistenceAdapter | undefined;
  const app = createApp({ token, principal: { scope, identity: 'shared-project-reader', allowedTools: implementedTools },
    handlers: readHandlers(async () => {
      repository ??= new DurablePersistenceAdapter((await connection()).storage);
      return repository;
    }),
    ready: async () => { await (await connection()).client.db(database).command({ ping: 1 }); },
  });
  const port = Number(process.env.PORT ?? '8010');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const listener = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(JSON.stringify({ event: 'mcp_listening', port, mode: 'shared-project-read-only' }));
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    listener.close(() => {
      void (pending ? pending.then(value => value.close()).catch(() => {}) : Promise.resolve()).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
void main().catch(() => { console.error('MCP_STARTUP_FAILED'); process.exitCode = 1; });
