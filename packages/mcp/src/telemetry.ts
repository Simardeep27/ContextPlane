import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'langsmith';

export interface TraceRecord {
  id: string;
  name: string;
  kind: 'chain' | 'tool';
  startedAt: number;
  endedAt: number;
  parentId?: string;
  error?: string;
  metadata: Record<string, string | number | boolean>;
}
export interface Telemetry {
  record(trace: TraceRecord): void;
  flush(): Promise<void>;
  status(): Record<string, unknown>;
}
export const noTelemetry: Telemetry = { record() {}, async flush() {}, status: () => ({ enabled: false }) };
export const traceId = () => randomUUID();

/** Declared names are labels, not authenticated person identities. */
export function agentLabel(value: unknown): string {
  if (typeof value !== 'string') return 'unspecified';
  if (['codex:nyny', 'shivraj:primary', 'simar:primary', 'buddh:primary', 'tanish:primary'].includes(value)) return value;
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

export function createTelemetry(options: {
  client: Pick<Client, 'createRun'>;
  project: string;
  log?: (entry: Record<string, unknown>) => void;
  maxPending?: number;
}): Telemetry {
  const pending = new Set<Promise<void>>();
  let succeeded = 0, failed = 0, dropped = 0;
  let lastErrorStatus: number | null = null;
  const log = options.log ?? (entry => console.error(JSON.stringify(entry)));
  return {
    record(trace) {
      if (pending.size >= (options.maxPending ?? 32)) {
        dropped++;
        log({ event: 'langsmith_trace_dropped', reason: 'capacity', traceId: trace.id });
        return;
      }
      // Only the explicitly constructed summary crosses the telemetry boundary.
      const payload = {
        id: trace.id, name: trace.name, run_type: trace.kind,
        project_name: options.project,
        start_time: trace.startedAt, end_time: trace.endedAt,
        ...(trace.parentId ? { parent_run_id: trace.parentId } : {}),
        ...(trace.error ? { error: trace.error } : {}),
        inputs: {}, outputs: { status: trace.error ? 'error' : 'success' },
        extra: { metadata: { ...trace.metadata, service: 'context-plane-mcp',
          duration_ms: Math.max(0, trace.endedAt - trace.startedAt) } },
        tags: ['context-plane', 'mcp', 'metadata-only'],
      };
      const task = Promise.resolve().then(() => options.client.createRun(payload))
        .then(() => { succeeded++; }, (error: unknown) => {
          failed++;
          lastErrorStatus = typeof error === 'object' && error !== null && 'status' in error &&
            typeof error.status === 'number' ? error.status : null;
          log({ event: 'langsmith_export_failed', traceId: trace.id, status: lastErrorStatus });
        })
        .finally(() => { pending.delete(task); });
      pending.add(task);
    },
    async flush() { await Promise.all([...pending]); },
    status: () => ({ enabled: true, project: options.project, pending: pending.size, succeeded, failed, dropped, lastErrorStatus }),
  };
}

export function telemetryFromEnvironment(): Telemetry {
  if (process.env.LANGSMITH_TRACING !== 'true') return noTelemetry;
  if (!process.env.LANGSMITH_API_KEY) {
    console.error(JSON.stringify({ event: 'langsmith_disabled', reason: 'missing_key' }));
    return noTelemetry;
  }
  const project = process.env.LANGSMITH_PROJECT ?? 'context-plane-mcp';
  const client = new Client({ apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: 'https://api.smith.langchain.com',
    autoBatchTracing: false, omitTracedRuntimeInfo: true, debug: false,
    timeout_ms: 3000, callerOptions: { maxRetries: 0 },
  });
  console.log(JSON.stringify({ event: 'langsmith_enabled', project, capture: 'metadata-only' }));
  return createTelemetry({ client, project });
}
