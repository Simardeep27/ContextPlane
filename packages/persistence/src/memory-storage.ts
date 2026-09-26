import type { ProjectScope } from '@context-plane/contracts';
import type { CollectionKind, Storage, StorageTransaction } from './storage.js';
import { scopedKey } from './validation.js';

type Row = { value: unknown; cursor?: number };
/** In-process transactional test double. Share this object across restart fixtures. */
export class MemoryStorage implements Storage {
  private rows = new Map<string, Row>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly clock: () => Date = () => new Date()) {}
  private key(scope: ProjectScope, kind: CollectionKind, key: string) {
    return JSON.stringify([kind, scopedKey(scope, key)]);
  }
  async transaction<T>(scope: ProjectScope, action: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    scopedKey(scope, 'state');
    const work = this.tail.then(async () => {
      const draft = structuredClone(this.rows);
      const result = await action({ now: this.clock(),
        get: async <V>(kind: CollectionKind, key: string) =>
          structuredClone(draft.get(this.key(scope, kind, key))?.value as V ?? null),
        put: async (kind, key, value, cursor) => {
          draft.set(this.key(scope, kind, key), { value: structuredClone(value), ...(cursor === undefined ? {} : { cursor }) });
        },
      });
      this.rows = draft; return structuredClone(result);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async read<T>(scope: ProjectScope, kind: CollectionKind, key: string): Promise<T | null> {
    return structuredClone(this.rows.get(this.key(scope, kind, key))?.value as T ?? null);
  }
  async events<T>(scope: ProjectScope, after: number, limit: number): Promise<T[]> {
    scopedKey(scope, 'state');
    return structuredClone([...this.rows.entries()].filter(([key, row]) => {
      const [kind, encoded] = JSON.parse(key) as [string, string];
      const [orgId, projectId] = JSON.parse(encoded) as string[];
      return kind === 'events' && orgId === scope.orgId && projectId === scope.projectId && (row.cursor ?? 0) > after;
    }).map(([, row]) => row).sort((a, b) => a.cursor! - b.cursor!).slice(0, limit).map(row => row.value as T));
  }
}
