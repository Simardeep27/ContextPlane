export interface DerivedEntry { key: string; kind: 'episode' | 'insight'; title: string; body: string; sourceIds: string[]; entryId: string }
export interface CoordinationMessageLike { messageId: string; senderIdentity: string; createdAt: string; body: string }
export interface LedgerEventLike { messageId: string; senderIdentity: string; createdAt: string; type?: string | null;
  summary?: string | null; task?: string | null; files?: string[] }
export interface BrainEntryLike { entryId: string }
export interface BrainWriter {
  listByPrefix(scope: string, prefix: string, limit: number): Promise<readonly BrainEntryLike[]>;
  remember(input: { scope: string; kind: string; title: string; body: string; sourceIds: string[]; author: string;
    entryId: string; supersedes?: string }): Promise<unknown>;
}
export const COLLISION_WINDOW_MS: number;
export function toReport(message: CoordinationMessageLike): unknown;
export function distill(messages: readonly CoordinationMessageLike[]): DerivedEntry[];
export function fromLedgerEvent(event: LedgerEventLike): CoordinationMessageLike;
export function applyDistillation(brain: BrainWriter, scope: string, author: string, derived: readonly DerivedEntry[],
  options?: { dryRun?: boolean }): Promise<{ created: number; unchanged: number; superseding: number }>;
