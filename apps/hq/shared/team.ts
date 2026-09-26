// Presentation-only projection of existing work-status surfaces, never a new ledger.
export const people = ['Shivraj', 'Simar', 'Buddh', 'Tanish'] as const;
export type Person = typeof people[number];
export type TeamAgent = {
  identity: string; person: Person | 'Other'; instanceId: string | null;
  task: string | null; currentTask: string | null; status: string;
  blockedOn: string[]; nextAction: string | null; files: string[]; evidence: string[];
  reportedAt: string | null; publishedAt: string | null; revision: number | null;
};
export type TeamEvent = { messageId: string; senderIdentity: string; createdAt: string;
  type: string | null; summary: string | null; task: string | null; files: string[] };
export type TeamSnapshot = { fetchedAt: string; agents: TeamAgent[]; possiblyTruncated: boolean;
  events?: TeamEvent[]; eventsAvailable?: boolean };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 2000) => typeof v === 'string' && v.trim() ? v.slice(0, max) : null;
const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 30).map(x => text(x)).filter((x): x is string => x !== null) : [];
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
export function freshness(agent: TeamAgent, now: number): 'recent' | 'stale' | 'unknown' {
  if (!agent.reportedAt) return 'unknown';
  const age = now - Date.parse(agent.reportedAt);
  if (age < -60_000) return 'unknown';
  return age > 15 * 60_000 ? 'stale' : 'recent';
}
export function projectTeam(value: unknown, now = new Date()): TeamSnapshot {
  const context = record(record(value).context);
  if (!Array.isArray(context.surfaces)) throw new Error('CONTEXT_UNAVAILABLE');
  const agents = new Map<string, TeamAgent>();
  for (const raw of context.surfaces) {
    const s = record(raw); const c = record(s.content);
    if (s.surfaceName !== 'work-status' || s.kind !== 'team-context' || s.coordinationScope !== 'project:context-plane') continue;
    const identity = text(s.ownerIdentity, 256); if (!identity) continue;
    // Ownership is declared project data, not authenticated personal identity.
    const prefix = identity.split(':')[0]?.toLowerCase();
    const declared = text(c.person)?.toLowerCase();
    const person = people.find(p => p.toLowerCase() === prefix) ??
      people.find(p => p.toLowerCase() === declared || p === 'Buddh' && declared === 'buddhsen') ?? 'Other';
    const agent: TeamAgent = { identity, person, instanceId: text(c.instanceId, 256),
      task: text(c.task), currentTask: text(c.currentTask),
      status: ['working','blocked','handed_off','done','stopped'].includes(String(c.status)) ? String(c.status) : 'unknown',
      blockedOn: list(c.blockedOn), nextAction: text(c.nextAction), files: list(c.files), evidence: list(c.evidence),
      reportedAt: date(c.updatedAt), publishedAt: date(s.updatedAt), revision: Number.isSafeInteger(s.revision) ? s.revision as number : null };
    const prior = agents.get(identity);
    if (!prior || (agent.revision ?? 0) > (prior.revision ?? 0)) agents.set(identity, agent);
  }
  return { fetchedAt: now.toISOString(), agents: [...agents.values()].sort((a,b) => a.identity.localeCompare(b.identity)), possiblyTruncated: context.surfaces.length >= 100 };
}
/** Allowlisted projection of the MCP read_ledger result (already sanitized server-side). */
export function projectLedger(value: unknown): TeamEvent[] {
  const events = record(value).events;
  if (!Array.isArray(events)) throw new Error('LEDGER_UNAVAILABLE');
  return events.slice(0, 200).flatMap(raw => {
    const e = record(raw); const messageId = text(e.messageId, 256); const senderIdentity = text(e.senderIdentity, 256);
    const createdAt = date(e.createdAt);
    if (!messageId || !senderIdentity || !createdAt) return [];
    return [{ messageId, senderIdentity, createdAt, type: text(e.type, 64), summary: text(e.summary, 280),
      task: text(e.task, 500), files: list(e.files) }];
  });
}
