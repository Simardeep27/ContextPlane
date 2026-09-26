import type { ProjectScope } from '@context-plane/contracts';

export type CollectionKind = 'runs' | 'events' | 'receipts' | 'projects';
export interface StoredValue { [key: string]: unknown }
export interface StorageTransaction {
  /** Server clock for MongoDB; injected clock for fixtures. */
  readonly now: Date;
  get<T>(kind: CollectionKind, key: string): Promise<T | null>;
  put<T>(kind: CollectionKind, key: string, value: T, cursor?: number): Promise<void>;
}
export interface Storage {
  transaction<T>(scope: ProjectScope, action: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  read<T>(scope: ProjectScope, kind: CollectionKind, key: string): Promise<T | null>;
  events<T>(scope: ProjectScope, after: number, limit: number): Promise<T[]>;
}
