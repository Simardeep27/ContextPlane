import { createHash } from 'node:crypto';
import type { ProjectScope } from '@context-plane/contracts';

export class PersistenceError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'LEASE_LOST' | 'IDEMPOTENCY_CONFLICT' | 'STORAGE_UNAVAILABLE') {
    super(code); this.name = 'PersistenceError';
  }
}
export function requireThat(condition: unknown, code: PersistenceError['code'] = 'INVALID_INPUT'): asserts condition {
  if (!condition) throw new PersistenceError(code);
}
export function identifier(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 256);
}
export function scopedKey(scope: ProjectScope, key: string): string {
  identifier(scope?.orgId); identifier(scope?.projectId); identifier(key);
  return JSON.stringify([scope.orgId, scope.projectId, key]);
}
export function sameScope(left: ProjectScope, right: ProjectScope) {
  requireThat(scopedKey(left, 'scope') === scopedKey(right, 'scope'));
}
export function integer(value: unknown, min = 0): asserts value is number {
  requireThat(typeof value === 'number' && Number.isSafeInteger(value) && value >= min);
}
export function timestamp(value: unknown) {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
export function cursorNumber(cursor: string): number {
  requireThat(typeof cursor === 'string' && /^\d{6,16}$/.test(cursor));
  const value = Number(cursor); integer(value);
  requireThat(cursor === formatCursor(value));
  return value;
}
export function formatCursor(value: number): string {
  integer(value); return String(value).padStart(6, '0');
}
function canonical(value: unknown, depth = 0): string {
  requireThat(depth <= 20);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + Array.from(value, item => canonical(item, depth + 1)).join(',') + ']';
  requireThat(typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.keys(value).sort().map(key => {
    requireThat(!key.startsWith('$') && !key.includes('.') && key !== '__proto__');
    return JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key], depth + 1);
  }).join(',') + '}';
}
/** Bounded JSON only; no BSON coercion, undefined, functions, dates, or operators. */
export function hash(value: unknown): string {
  const serialized = canonical(value);
  requireThat(Buffer.byteLength(serialized) <= 128 * 1024);
  return createHash('sha256').update(serialized).digest('hex');
}
export async function sanitized<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof PersistenceError) throw error;
    // Never expose driver hosts, connection strings or command payloads.
    throw new PersistenceError('STORAGE_UNAVAILABLE');
  }
}
