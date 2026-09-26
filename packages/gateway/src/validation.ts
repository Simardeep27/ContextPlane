import { timingSafeEqual } from 'node:crypto';
import { toolDefinitions, type ToolName } from '@context-plane/contracts';

export class HarnessError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'HarnessError'; }
}
export function requireThat(value: unknown, code: string, status = 409): asserts value {
  if (!value) throw new HarnessError(code, status);
}
export function safeKey(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value), 'INVALID_KEY', 400);
}
export function plain(value: unknown, depth = 0): void {
  requireThat(depth <= 12, 'INVALID_INPUT', 400);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'INVALID_INPUT', 400); return; }
  if (Array.isArray(value)) { requireThat(value.length <= 100, 'INVALID_INPUT', 400); value.forEach(v => plain(v, depth + 1)); return; }
  requireThat(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_INPUT', 400);
  for (const [key, nested] of Object.entries(value)) {
    requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_INPUT', 400);
    plain(nested, depth + 1);
  }
}
export function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
interface Schema { type?: string; minLength?: number; minimum?: number; items?: Schema; properties?: Record<string, Schema>; required?: readonly string[] }
function matches(value: unknown, schema: Schema): boolean {
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= 4096;
  if (schema.type === 'integer') return Number.isSafeInteger(value) && (value as number) >= (schema.minimum ?? 0);
  if (schema.type === 'array') return Array.isArray(value) && value.length <= 100 && value.every(item => matches(item, schema.items ?? {}));
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>; const properties = schema.properties ?? {};
    return Object.keys(obj).every(key => Object.hasOwn(properties, key)) &&
      (schema.required ?? []).every(key => Object.hasOwn(obj, key)) &&
      Object.entries(obj).every(([key, item]) => matches(item, properties[key]!));
  }
  return false;
}
export function validateArgs(tool: ToolName, args: Record<string, unknown>): void {
  plain(args); requireThat(Buffer.byteLength(JSON.stringify(args)) <= 32768, 'INVALID_INPUT', 400);
  requireThat(matches(args, toolDefinitions[tool].inputSchema as Schema), 'INVALID_INPUT', 400);
}
