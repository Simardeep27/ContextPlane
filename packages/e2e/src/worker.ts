import { join, isAbsolute } from 'node:path';
import type { ProjectScope, RunId } from '@context-plane/contracts';
import { DurablePersistenceAdapter, connectStorage } from '@context-plane/persistence';
import { ScenarioRunner } from '@context-plane/runner';
import { createHarness, createGatewayServer, OpenRouterProvider, runAgent } from '@context-plane/gateway';
import { FileStorage } from './file-storage.js';

export type WorkerConfiguration = {
  directory: string;
  mode: 'file' | 'atlas' | 'mongo-local';
  scope: ProjectScope;
  runId: RunId;
  credentials: Parameters<typeof createHarness>[0]['credentials'];
  controllerToken: string;
  crashOnCombinedPublication: boolean;
  leaseDurationMs: number;
  model?: string;
};

process.once('message', async (configuration: WorkerConfiguration) => {
  let close: (() => Promise<void>) | undefined;
  try {
    if (!isAbsolute(configuration.directory) || !configuration.scope.projectId.startsWith('e2e_')) throw new Error('Invalid isolated configuration');
    if (!['file', 'atlas', 'mongo-local'].includes(configuration.mode)) throw new Error('Invalid storage');
    // Hard-coded database boundary. Never honor a DB override from a client or URI path.
    const database = configuration.mode === 'atlas' ? 'shivraj_experiments'
      : configuration.mode === 'mongo-local' ? 'context_plane_e2e_local' : null;
    const connection = configuration.mode === 'mongo-local'
      ? await connectStorage('context_plane_e2e_local', 'mongodb://127.0.0.1:27027/?directConnection=true&replicaSet=rs0')
      : configuration.mode === 'atlas' ? await connectStorage('shivraj_experiments') : undefined;
    if (connection) { close = connection.close; await connection.storage.initialize(); }
    const storage = connection?.storage ?? new FileStorage(join(configuration.directory, 'storage.json'));
    const persistence = new DurablePersistenceAdapter(storage, { leaseDurationMs: configuration.leaseDurationMs });
    const harness = createHarness({
      persistence,
      runner: new ScenarioRunner(join(configuration.directory, 'runner')),
      scope: configuration.scope,
      runId: configuration.runId,
      credentials: configuration.credentials,
      controllerToken: configuration.controllerToken,
      heartbeatMs: Math.max(10, Math.floor(configuration.leaseDurationMs / 3)),
      crashAfterEffect: proof => {
        if (configuration.crashOnCombinedPublication && proof.snapshotId === 'combined-candidate') {
          // Real process death, after the atomic external effect and before the final DB commit.
          process.kill(process.pid, 'SIGKILL');
        }
      },
    });
    const provider = configuration.model ? new OpenRouterProvider({
      apiKey: process.env.OPENROUTER_API_KEY ?? '', model: configuration.model,
      journalDirectory: join(configuration.directory, 'inference'),
    }) : undefined;
    if (provider) process.on('message', async (message: { type?: string; token: string; jobKey: string; task: string; maxTurns: number }) => {
      if (message.type !== 'agent-job') return;
      try {
        const result = await runAgent({ harness, provider, token: message.token,
          jobKey: message.jobKey, task: message.task, maxTurns: message.maxTurns });
        process.send?.({ type: 'agent-result', result });
      } catch (error) {
        const code = error instanceof Error && /^(?:OPENROUTER_[A-Z_0-9]+|INVALID_[A-Z_]+|INFERENCE_[A-Z_]+|LEASE_LOST|RUN_LEASED|RUN_BUDGET_EXCEEDED)$/.test(error.message) ? error.message : 'AGENT_JOB_FAILED';
        process.send?.({ type: 'agent-error', message: code });
      }
    });
    const server = createGatewayServer(harness);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Invalid listener');
      process.send?.({ type: 'ready', port: address.port, storage: configuration.mode, database });
    });
    process.once('SIGTERM', () => server.close(() => {
      void (close?.() ?? Promise.resolve()).finally(() => process.exit(0));
    }));
  } catch {
    // Driver errors can contain connection details. Do not forward raw messages.
    await close?.();
    process.send?.({ type: 'error', message: 'Isolated worker startup failed; inspect credential readiness without printing secrets.' });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
