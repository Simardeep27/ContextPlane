// Deterministic "harness optimizer": rule-based reasoning over the projected ledger. No model calls.
import { people, personOf, type Person, type TeamAgent, type TeamEvent, type TeamEventType, type TeamSnapshot } from './team.ts';

export const IDLE_MS = 15 * 60_000;
export type ChipStatus = 'working' | 'blocked' | 'finished' | 'idle';
export type AgentView = {
  identity: string; suffix: string; person: Person | 'Other'; status: ChipStatus;
  task: string | null; summary: string | null; files: string[]; updatedAt: string | null;
  lastEventType: TeamEventType | null; idleMinutes: number | null;
};
export type Collision = { a: string; b: string; reason: 'files' | 'task'; subject: string };
export type OptimizerReport = {
  totalEvents: number; eventsLastHour: number; eventSource: 'ledger' | 'surfaces';
  active: number; blocked: number; finished: number; idle: number;
  collisions: Collision[]; idleAgents: AgentView[]; suggestion: string;
};

const finishedEvents = new Set<TeamEventType>(['work_finished', 'handoff']);
const finishedStates = new Set(['stopped', 'done', 'handed_off']);
const ms = (v: string | null) => v ? Date.parse(v) : NaN;

export function suffixOf(identity: string) { const i = identity.indexOf(':'); return i < 0 ? identity : identity.slice(i + 1); }

export function latestByActor(events: TeamEvent[]) {
  const latest = new Map<string, TeamEvent>();
  for (const e of events) { const prior = latest.get(e.actor); if (!prior || ms(e.occurredAt) >= ms(prior.occurredAt)) latest.set(e.actor, e); }
  return latest;
}

/** One agent's chip: the newest signal (ledger event or work-status surface) wins. */
export function agentView(agent: TeamAgent | null, event: TeamEvent | undefined, now: number, identity = agent?.identity ?? event?.actor ?? ''): AgentView {
  const surfaceAt = ms(agent?.reportedAt ?? null); const eventAt = ms(event?.occurredAt ?? null);
  const eventNewer = event !== undefined && (!Number.isFinite(surfaceAt) || eventAt >= surfaceAt);
  const updatedAt = eventNewer ? event!.occurredAt : agent?.reportedAt ?? null;
  const age = Number.isFinite(ms(updatedAt)) ? now - ms(updatedAt) : Infinity;
  const signal = eventNewer ? event!.type : agent?.status ?? 'unknown';
  const status: ChipStatus = finishedEvents.has(signal as TeamEventType) || finishedStates.has(signal) ? 'finished'
    : signal === 'blocked' ? 'blocked'
    : age > IDLE_MS ? 'idle' : 'working';
  const files = eventNewer && event!.files.length ? event!.files : agent?.files.length ? agent.files : event?.files ?? [];
  return { identity, suffix: suffixOf(identity), person: agent?.person ?? personOf(identity),
    status, task: agent?.task ?? event?.task ?? null,
    summary: eventNewer ? event!.summary ?? agent?.currentTask ?? null : agent?.currentTask ?? event?.summary ?? null,
    files, updatedAt, lastEventType: event?.type ?? null,
    idleMinutes: Number.isFinite(age) ? Math.max(0, Math.floor(age / 60_000)) : null };
}

/** Every agent seen in surfaces or ledger events, as chips. */
export function agentViews(snapshot: Pick<TeamSnapshot, 'agents' | 'events'>, now: number): AgentView[] {
  const latest = latestByActor(snapshot.events);
  const views = snapshot.agents.map(a => agentView(a, latest.get(a.identity), now));
  const known = new Set(snapshot.agents.map(a => a.identity));
  for (const [actor, e] of latest) if (!known.has(actor)) views.push(agentView(null, e, now, actor));
  return views.sort((a, b) => a.identity.localeCompare(b.identity));
}

export type PersonGroup = { person: Person | 'Other'; agents: AgentView[] };
export function groupByPerson(views: AgentView[]): PersonGroup[] {
  const groups: PersonGroup[] = people.map(person => ({ person, agents: views.filter(v => v.person === person) }));
  const other = views.filter(v => v.person === 'Other');
  return other.length ? [...groups, { person: 'Other', agents: other }] : groups;
}

const dirOf = (f: string) => f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
const issueRefs = (v: string | null) => new Set((v ?? '').match(/(?:issues\/|#)(\d+)\b/g)?.map(x => '#' + x.replace(/\D/g, '')) ?? []);
const norm = (v: string | null) => v?.trim().toLowerCase().replace(/\s+/g, ' ') || null;

/** Two different active agents whose latest reports overlap on files/directories, an issue, or the same task. */
export function collisions(views: AgentView[]): Collision[] {
  const active = views.filter(v => v.status === 'working' || v.status === 'blocked');
  const out: Collision[] = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i]!, b = active[j]!;
    const shared = a.files.find(f => b.files.includes(f));
    // Same parent directory counts when it is specific (at least three path segments).
    const dir = shared ? null : a.files.map(dirOf).find(d => d.split('/').length >= 3 && b.files.some(f => dirOf(f) === d));
    if (shared || dir) { out.push({ a: a.identity, b: b.identity, reason: 'files', subject: shared ?? dir! }); continue; }
    const aRefs = issueRefs(`${a.task ?? ''} ${a.summary ?? ''}`); const issue = [...issueRefs(`${b.task ?? ''} ${b.summary ?? ''}`)].find(r => aRefs.has(r));
    if (issue) { out.push({ a: a.identity, b: b.identity, reason: 'task', subject: `issue ${issue}` }); continue; }
    if (norm(a.task) && norm(a.task) === norm(b.task)) out.push({ a: a.identity, b: b.identity, reason: 'task', subject: a.task! });
  }
  return out;
}

export function optimize(snapshot: Pick<TeamSnapshot, 'agents' | 'events'>, now: number): OptimizerReport {
  const views = agentViews(snapshot, now);
  const count = (s: ChipStatus) => views.filter(v => v.status === s).length;
  const ledger = snapshot.events.length > 0;
  const times = ledger ? snapshot.events.map(e => ms(e.occurredAt)) : snapshot.agents.map(a => ms(a.reportedAt)).filter(Number.isFinite);
  const found = collisions(views);
  const idleAgents = views.filter(v => v.status === 'idle').sort((a, b) => (b.idleMinutes ?? Infinity) - (a.idleMinutes ?? Infinity));
  const blocked = views.filter(v => v.status === 'blocked');
  const active = count('working') + blocked.length;
  const c = found[0];
  const suggestion = c ? `${c.a} and ${c.b} both touch ${c.subject} — coordinate`
    : blocked[0] ? `${blocked[0].identity} is blocked${blocked[0].summary ? `: ${blocked[0].summary}` : ''} — unblock first`
    : idleAgents[0] ? `${idleAgents[0].identity} has been quiet ${idleAgents[0].idleMinutes === null ? 'with no report time' : `${idleAgents[0].idleMinutes}m`} — check in or send work_finished`
    : active === 0 ? 'No active agents — pick up the next task'
    : `No overlaps across ${active} active ${active === 1 ? 'agent' : 'agents'} — keep going`;
  return { totalEvents: times.length, eventsLastHour: times.filter(t => t <= now + 60_000 && now - t <= 3_600_000).length,
    eventSource: ledger ? 'ledger' : 'surfaces', active, blocked: blocked.length, finished: count('finished'), idle: idleAgents.length,
    collisions: found, idleAgents, suggestion };
}
