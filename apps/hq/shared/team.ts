// Presentation-only projection of existing work-status surfaces, never a new ledger.
export const people = ['Shivraj', 'Simar', 'Buddh', 'Tanish'] as const;
export type Person = typeof people[number];
export type TeamAgent = {
  identity: string; person: Person | 'Other'; instanceId: string | null;
  task: string | null; currentTask: string | null; status: string;
  blockedOn: string[]; nextAction: string | null; files: string[]; evidence: string[];
  reportedAt: string | null; publishedAt: string | null; revision: number | null;
};
export const eventTypes = ['work_started','progress','decision','blocked','checks_finished','handoff','work_finished'] as const;
export type TeamEventType = typeof eventTypes[number];
/** Allowlisted ledger event: only these fields ever reach the browser. */
export type TeamEvent = { type: TeamEventType; actor: string; task: string | null; summary: string | null; files: string[]; occurredAt: string };
export type TeamSnapshot = { fetchedAt: string; agents: TeamAgent[]; events: TeamEvent[]; possiblyTruncated: boolean };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 2000) => typeof v === 'string' && v.trim() ? v.slice(0, max) : null;
const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 30).map(x => text(x)).filter((x): x is string => x !== null) : [];
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
/** Person = identity prefix before the first ':' (buddhsen aliases Buddh), else declared person, else Other. */
export function personOf(identity: string, declaredPerson?: string | null): Person | 'Other' {
  const match = (v: string | null | undefined) => { const k = v?.toLowerCase(); return people.find(p => p.toLowerCase() === k || p === 'Buddh' && k === 'buddhsen'); };
  return match(identity.split(':')[0]) ?? match(declaredPerson) ?? 'Other';
}
export function freshness(agent: TeamAgent, now: number): 'recent' | 'stale' | 'unknown' {
  if (!agent.reportedAt) return 'unknown';
  const age = now - Date.parse(agent.reportedAt);
  if (age < -60_000) return 'unknown';
  return age > 15 * 60_000 ? 'stale' : 'recent';
}
function projectEvent(raw: unknown): TeamEvent | null {
  const m = record(raw);
  let body: Record<string, unknown> = record(m.body);
  if (typeof m.body === 'string' && m.body.length <= 8000) { try { body = record(JSON.parse(m.body)); } catch { return null; } }
  const type = eventTypes.find(t => t === body.type); const occurredAt = date(body.occurredAt);
  const actor = text(body.actor, 256) ?? text(m.identity, 256) ?? text(m.sender, 256);
  if (!type || !occurredAt || !actor) return null;
  return { type, actor, task: text(body.task, 500), summary: text(body.summary, 280), files: list(body.files), occurredAt };
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
    const person = personOf(identity, text(c.person));
    const agent: TeamAgent = { identity, person, instanceId: text(c.instanceId, 256),
      task: text(c.task), currentTask: text(c.currentTask),
      status: ['working','blocked','handed_off','done','stopped'].includes(String(c.status)) ? String(c.status) : 'unknown',
      blockedOn: list(c.blockedOn), nextAction: text(c.nextAction), files: list(c.files), evidence: list(c.evidence),
      reportedAt: date(c.updatedAt), publishedAt: date(s.updatedAt), revision: Number.isSafeInteger(s.revision) ? s.revision as number : null };
    const prior = agents.get(identity);
    if (!prior || (agent.revision ?? 0) > (prior.revision ?? 0)) agents.set(identity, agent);
  }
  // Ledger messages are optional in the context read; project only allowlisted event fields.
  const rawEvents = Array.isArray(context.messages) ? context.messages : [];
  const events = rawEvents.slice(-500).map(projectEvent).filter((e): e is TeamEvent => e !== null)
    .sort((a,b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  return { fetchedAt: now.toISOString(), agents: [...agents.values()].sort((a,b) => a.identity.localeCompare(b.identity)), events, possiblyTruncated: context.surfaces.length >= 100 };
}
