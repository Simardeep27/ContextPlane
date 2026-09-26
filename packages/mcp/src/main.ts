import { telemetryFromEnvironment } from './telemetry.js';
import type { ProjectScope } from '@context-plane/contracts';
import { connectStorage, DurablePersistenceAdapter } from '@context-plane/persistence';
import { createApp } from './app.js';
import { MongoCoordinationRepository } from './coordination.js';
import { MongoBrainRepository } from './brain.js';
import { brainHandlers, coordinationHandlers, implementedTools, overlapHandlers, readHandlers } from './domain.js';
import { embedderFromEnvironment, MongoWorkEmbeddingStore, OverlapService, type WorkEmbeddingStore } from './overlap.js';

function setting(name: string): string {
  const value = process.env[name];
  if (!value || value.length > 256) throw new Error('MISSING_RUNTIME_SETTING');
  return value;
}
async function main() {
  const scope = { orgId: setting('CONTEXT_PLANE_ORG_ID'), projectId: setting('CONTEXT_PLANE_PROJECT_ID') } as ProjectScope;
  const database = setting('MONGODB_DATABASE');
  const token = setting('CONTEXT_PLANE_API_TOKEN');
  const coordinationScope = setting('CONTEXT_PLANE_COORDINATION_SCOPE');
  let pending: Promise<Awaited<ReturnType<typeof connectStorage>>> | undefined;
  const connection = () => {
    // Cache only successful connections, and retry after an unavailable Atlas.
    pending ??= connectStorage(database).catch(error => { pending = undefined; throw error; });
    return pending;
  };
  let repository: DurablePersistenceAdapter | undefined;
  let coordination: Promise<MongoCoordinationRepository> | undefined;
  const coordinationRepository = async () => {
    coordination ??= (async () => {
      const active = await connection();
      const initialized = new MongoCoordinationRepository(active.client.db(database), scope);
      await initialized.initialize();
      return initialized;
    })().catch(error => { coordination = undefined; throw error; });
    return coordination;
  };
  let brain: Promise<MongoBrainRepository> | undefined;
  const brainRepository = async () => {
    brain ??= (async () => {
      const initialized = new MongoBrainRepository((await connection()).client.db(database), scope);
      await initialized.initialize();
      return initialized;
    })().catch(error => { brain = undefined; throw error; });
    return brain;
  };
  let workStore: Promise<MongoWorkEmbeddingStore> | undefined;
  const workEmbeddings = async () => {
    workStore ??= (async () => {
      const initialized = new MongoWorkEmbeddingStore((await connection()).client.db(database), scope);
      await initialized.initialize();
      return initialized;
    })().catch(error => { workStore = undefined; throw error; });
    return workStore;
  };
  const lazyStore: WorkEmbeddingStore = {
    upsert: async record => (await workEmbeddings()).upsert(record),
    vectorSearch: async (...args) => (await workEmbeddings()).vectorSearch(...args),
    list: async (...args) => (await workEmbeddings()).list(...args),
  };
  // VOYAGE_API_KEY is optional; without it check_overlap uses the lexical fallback.
  const overlap = new OverlapService(lazyStore, embedderFromEnvironment());
  const telemetry = telemetryFromEnvironment();
  const app = createApp({ telemetry, token, principal: { scope, coordinationScope,
    identity: 'shared-project-coordinator', allowedTools: implementedTools },
    handlers: { ...readHandlers(async () => {
      repository ??= new DurablePersistenceAdapter((await connection()).storage);
      return repository;
    }), ...coordinationHandlers(coordinationRepository, brainRepository, undefined, overlap),
    ...brainHandlers(coordinationRepository, brainRepository),
    ...overlapHandlers(coordinationRepository, overlap) },
    ready: async () => {
      await (await connection()).client.db(database).command({ ping: 1 });
      await coordinationRepository();
      await brainRepository();
    },
  });
  const port = Number(process.env.PORT ?? '8010');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const listener = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(JSON.stringify({ event: 'mcp_listening', port, mode: 'shared-project-coordination' }));
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    listener.close(() => {
      void Promise.all([telemetry.flush(), pending ? pending.then(value => value.close()).catch(() => {}) : Promise.resolve()]).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
void main().catch(() => { console.error('MCP_STARTUP_FAILED'); process.exitCode = 1; });
