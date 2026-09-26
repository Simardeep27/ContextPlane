// Live-team presentation helpers for the 3D HQ: layout, status colors, and a
// deterministic command-center answer over the allowlisted /api/team projection.
import type { AgentView, ChipStatus, OptimizerReport } from './harness.ts';
import { people } from './team.ts';

export type Vec3 = readonly [number, number, number];
/** Legend state (see stateColors) used to color each live status. */
export type LegendState = 'coding' | 'blocked' | 'complete' | 'idle';
const legendByStatus: Readonly<Record<ChipStatus, LegendState>> = { working: 'coding', blocked: 'blocked', finished: 'complete', idle: 'idle' };
export function legendState(status: ChipStatus): LegendState { return legendByStatus[status] ?? 'idle'; }
export const statusLabels: Readonly<Record<ChipStatus, string>> = { working: 'Working', blocked: 'Blocked', finished: 'Finished', idle: 'Idle' };

export const displayName = (person: string) => person === 'Buddh' ? 'Buddhsen' : person;

/** Pads sit on a ring around the central company brain. */
export const PAD_DISTANCE = 5.6;
/** Arc length between neighbouring robots on a pad's ring. */
export const ROBOT_SPACING = 1.0;
export const MIN_RING = 0.85;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Robot offsets (x, z) on one pad: one robot sits in the middle, more form an evenly spaced ring. */
export function ringOffsets(count: number): Array<readonly [number, number]> {
  if (count <= 0) return [];
  if (count === 1) return [[0, 0]];
  const radius = ringRadius(count);
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [round(Math.cos(angle) * radius), round(Math.sin(angle) * radius)] as const;
  });
}
export function ringRadius(count: number) { return count <= 1 ? 0 : Math.max(MIN_RING, (count * ROBOT_SPACING) / (2 * Math.PI)); }
/** Pad disc radius that fits its ring with a margin. */
export function padRadius(count: number) { return round(ringRadius(count) + 0.75); }

/** Pad centres on a circle; the first pad faces the camera-left side. */
export function padCenters(count: number, distance = PAD_DISTANCE): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * 0.75 + (i * 2 * Math.PI) / Math.max(count, 1);
    return [round(Math.cos(angle) * distance), 0, round(-Math.sin(angle) * distance)] as const;
  });
}

export type PlacedAgent = { view: AgentView; position: Vec3 };
export type PadLayout = { person: string; label: string; center: Vec3; radius: number; agents: PlacedAgent[] };

/** One pad per known person (plus Other when needed), each with its agents on a ring. */
export function layoutTeam(views: readonly AgentView[], order: readonly string[] = people): PadLayout[] {
  const known = new Set(order);
  const persons = [...order];
  if (views.some(v => !known.has(v.person))) persons.push('Other');
  const centers = padCenters(persons.length);
  return persons.map((person, i) => {
    const agents = views.filter(v => person === 'Other' ? !known.has(v.person) : v.person === person)
      .slice().sort((a, b) => a.identity.localeCompare(b.identity));
    const center = centers[i]!;
    const offsets = ringOffsets(agents.length);
    return { person, label: displayName(person), center, radius: padRadius(agents.length),
      agents: agents.map((view, j) => ({ view, position: [round(center[0] + offsets[j]![0]), 0, round(center[2] + offsets[j]![1])] as const })) };
  });
}

/** Header line, e.g. "Live · 11 agents · last fetched 14:03:22". */
export function liveHeader(count: number, fetchedAt: Date | null) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = fetchedAt ? `${pad(fetchedAt.getHours())}:${pad(fetchedAt.getMinutes())}:${pad(fetchedAt.getSeconds())}` : 'never';
  return `Live · ${count} ${count === 1 ? 'agent' : 'agents'} · last fetched ${time}`;
}

/** Identities whose report is new or newer than in the previous poll. Empty on the first poll. */
export function newReports(previous: readonly AgentView[] | null, next: readonly AgentView[]): string[] {
  if (!previous) return [];
  const before = new Map(previous.map(v => [v.identity, v.updatedAt]));
  return next.filter(v => !before.has(v.identity) || (v.updatedAt ?? '') > (before.get(v.identity) ?? '')).map(v => v.identity);
}

export type LiveAnswer = { heading: string; lines: Array<{ identity: string; status: ChipStatus; text: string }>; empty: string };
const statusOrder: ChipStatus[] = ['blocked', 'working', 'finished', 'idle'];

/** Deterministic keyword routing over live team data. No model calls. */
export function answerLive(question: string, views: readonly AgentView[]): LiveAnswer {
  const q = question.toLowerCase();
  const describe = (v: AgentView) => {
    const who = `${displayName(v.person)} · ${v.suffix}`;
    const what = v.summary ?? v.task ?? 'no task reported';
    return `${who} (${statusLabels[v.status].toLowerCase()}): ${what}`;
  };
  const pick = (status: ChipStatus | null) => views.filter(v => status === null || v.status === status)
    .slice().sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.identity.localeCompare(b.identity))
    .map(v => ({ identity: v.identity, status: v.status, text: describe(v) }));
  if (/block|stuck|wait/.test(q)) return { heading: 'Blocked agents', lines: pick('blocked'), empty: 'Nobody is blocked right now.' };
  if (/finish|done|complete|ship/.test(q)) return { heading: 'Finished work', lines: pick('finished'), empty: 'No agent has reported finished work yet.' };
  if (/idle|quiet|free|availab/.test(q)) return { heading: 'Idle agents', lines: pick('idle'), empty: 'No idle agents.' };
  if (/working on|active|busy|progress/.test(q) && !/everyone|every one|all|team/.test(q)) return { heading: 'Working now', lines: pick('working'), empty: 'No agent is actively working.' };
  return { heading: 'Everyone', lines: pick(null), empty: 'No agents have reported work-status yet.' };
}

// ---------- Company agent (harness optimizer) presentation ----------

/** How often the company agent's "thinking" line advances. */
export const INSIGHT_PERIOD_MS = 4000;

type InsightReport = Pick<OptimizerReport, 'suggestion' | 'collisions' | 'idleAgents' | 'active' | 'blocked' | 'finished' | 'eventsLastHour'>;

/** Every deterministic optimizer insight, most urgent first, without duplicates. */
export function companyInsights(report: InsightReport | null, views: readonly AgentView[]): string[] {
  if (!report) return ['Waiting for the first team report'];
  const out = [report.suggestion];
  for (const c of report.collisions) out.push(`${c.a} and ${c.b} both touch ${c.subject}`);
  for (const v of views) if (v.status === 'blocked') out.push(`${v.identity} is blocked${v.summary ? `: ${v.summary}` : ''}`);
  for (const v of report.idleAgents) out.push(`${v.identity} has been quiet ${v.idleMinutes === null ? '(no report time)' : `${v.idleMinutes}m`}`);
  out.push(`${report.finished} finished · ${report.active} active · ${report.eventsLastHour} ${report.eventsLastHour === 1 ? 'event' : 'events'} in the last hour`);
  return [...new Set(out)];
}

/** Index of the insight shown after `elapsedMs`; cycles every `periodMs`. */
export function insightIndex(count: number, elapsedMs: number, periodMs = INSIGHT_PERIOD_MS): number {
  if (count <= 0 || !Number.isFinite(elapsedMs)) return 0;
  return Math.floor(Math.max(0, elapsedMs) / periodMs) % count;
}

export type CompanyStatus = { label: string; tone: 'waiting' | 'attention' | 'ok' | 'quiet' };
/** Status chip for the company agent. */
export function companyStatus(report: InsightReport | null): CompanyStatus {
  if (!report) return { label: 'Waiting for data', tone: 'waiting' };
  if (report.collisions.length) return { label: `${report.collisions.length} ${report.collisions.length === 1 ? 'collision' : 'collisions'}`, tone: 'attention' };
  if (report.blocked) return { label: `${report.blocked} blocked`, tone: 'attention' };
  if (report.active) return { label: `Optimizing · ${report.active} active`, tone: 'ok' };
  return { label: 'Team quiet', tone: 'quiet' };
}

/** Pad subtitle, e.g. "3 agents · 2 working · 1 blocked". */
export function padSummary(agents: readonly Pick<AgentView, 'status'>[]): string {
  if (agents.length === 0) return 'no agents reporting';
  const working = agents.filter(a => a.status === 'working').length;
  const blocked = agents.filter(a => a.status === 'blocked').length;
  const parts = [`${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`];
  if (working) parts.push(`${working} working`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (!working && !blocked) parts.push('none active');
  return parts.join(' · ');
}

// ---------- Command-center panel ----------

export type PanelState = 'collapsed' | 'open' | 'max';
export const PANEL_STORAGE_KEY = 'company-harness.hq.panel';
export const PANEL_COLLAPSE_BELOW = 1360;
export const PANEL_WIDTH = 380;

/** Stored choice wins; otherwise collapsed on narrow laptops. */
export function initialPanelState(stored: string | null, viewportWidth: number): PanelState {
  if (stored === 'collapsed' || stored === 'open' || stored === 'max') return stored;
  return viewportWidth < PANEL_COLLAPSE_BELOW ? 'collapsed' : 'open';
}

/**
 * World-space x shift of the camera target so the scene centres in the space the
 * open left panel leaves free. `visibleWorldWidth` approximates the ground width in view.
 */
export function sceneShift(viewportWidth: number, panel: PanelState, panelPx = PANEL_WIDTH + 16, visibleWorldWidth = 24): number {
  if (panel === 'collapsed' || viewportWidth <= 960) return 0;
  const pxPerUnit = viewportWidth / visibleWorldWidth;
  return round(Math.min(4.5, panelPx / 2 / pxPerUnit));
}
