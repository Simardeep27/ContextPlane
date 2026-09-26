import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProjectScope } from '@context-plane/contracts';

type Kind = 'runs' | 'events' | 'receipts' | 'projects';
type Row = { value: unknown; cursor?: number };
type Transaction = {
  now: Date;
  get<T>(kind: Kind, key: string): Promise<T | null>;
  put<T>(kind: Kind, key: string, value: T, cursor?: number): Promise<void>;
};

/** Test-only, one-process-at-a-time storage. Enables real restart tests without Atlas.
 * Uses the real persistence adapter for all invariants. No multiprocess locking,
 * replica durability, or power-loss guarantee. Never a production DB substitute.
 */
export class FileStorage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  private key(scope: ProjectScope, kind: Kind, key: string) {
    return JSON.stringify([scope.orgId, scope.projectId, kind, key]);
  }
  private async load(): Promise<Map<string, Row>> {
    try { return new Map(JSON.parse(await readFile(this.path, 'utf8')) as [string, Row][]); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; }
  }
  async transaction<T>(scope: ProjectScope, action: (tx: Transaction) => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      const draft = await this.load();
      const result = await action({
        now: new Date(),
        get: async <V>(kind: Kind, key: string) => structuredClone(draft.get(this.key(scope, kind, key))?.value as V ?? null),
        put: async (kind, key, value, cursor) => {
          draft.set(this.key(scope, kind, key), { value: structuredClone(value), ...(cursor === undefined ? {} : { cursor }) });
        },
      });
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path + '.pending', JSON.stringify([...draft]), { mode: 0o600 });
      await rename(this.path + '.pending', this.path);
      return structuredClone(result);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async read<T>(scope: ProjectScope, kind: Kind, key: string): Promise<T | null> {
    await this.tail;
    return structuredClone((await this.load()).get(this.key(scope, kind, key))?.value as T ?? null);
  }
  async events<T>(scope: ProjectScope, after: number, limit: number): Promise<T[]> {
    await this.tail;
    return [...(await this.load()).entries()].filter(([key, row]) => {
      const [org, project, kind] = JSON.parse(key) as string[];
      return org === scope.orgId && project === scope.projectId && kind === 'events' && (row.cursor ?? 0) > after;
    }).map(([, row]) => row).sort((a, b) => a.cursor! - b.cursor!).slice(0, limit).map(row => structuredClone(row.value as T));
  }
}
