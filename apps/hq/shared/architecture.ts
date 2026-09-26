// Real snapshot of merged PRs on the Company Harness trunk, Sept 26 2026 (EDT).
// Entries marked `approx` were read off the trunk log at minute resolution.
export type MergedPr = { time: string; pr?: number; approx?: boolean };

export const snapshot = { date: '2026-09-26', label: 'snapshot 17:30 EDT', ledgerLive: '15:30' } as const;

export const mergedPrs: MergedPr[] = [
  { time: '13:38' }, { time: '13:49' }, { time: '15:16' }, { time: '15:16' }, { time: '15:17' },
  { time: '15:21' }, { time: '15:22' }, { time: '16:02' }, { time: '16:15' }, { time: '16:19' },
  { time: '16:26' }, { time: '16:28' }, { time: '16:31' }, { time: '16:37' }, { time: '16:40' },
  { time: '17:10', pr: 38, approx: true }, { time: '17:10', pr: 39, approx: true },
  { time: '17:25', pr: 40, approx: true }, { time: '17:25', pr: 41, approx: true },
  { time: '17:28', pr: 43, approx: true },
];

/** Measurement windows around the ledger going live. */
export const windows = { beforeHours: 5, afterMinutes: 75 } as const;

export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) throw new Error(`bad time ${hhmm}`);
  return h * 60 + m;
};

export function mergeRates(prs: MergedPr[] = mergedPrs) {
  const live = minutesOf(snapshot.ledgerLive);
  const times = prs.map((p) => minutesOf(p.time));
  const before = times.filter((t) => t < live && t >= live - windows.beforeHours * 60).length;
  const after = times.filter((t) => t >= live && t < live + windows.afterMinutes).length;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    before, after,
    beforePerHour: round1(before / windows.beforeHours),
    afterPerHour: round1(after / (windows.afterMinutes / 60)),
  };
}

/** Cumulative merged count at each merge time, for a step chart. */
export function cumulative(prs: MergedPr[] = mergedPrs) {
  return [...prs].map((p) => minutesOf(p.time)).sort((a, b) => a - b).map((t, i) => ({ t, n: i + 1 }));
}

export const stats = [
  { value: '15', label: 'agents on the ledger' },
  { value: '92+', label: 'status reports' },
  { value: '4 → 1', label: 'repos → one trunk' },
  { value: '7', label: 'pre-harness collisions' },
] as const;

export const collisions = ['restart', '2nd stack', '+2 repos', 'orphan branch', 'MVP-01/02 built twice', 'same file edited 3×', 'merge storm'] as const;

export const caveat = 'More parallel agents also contributed; the ledger is what let them work without another merge storm.';

export type LoopNode = 'agent' | 'gateway' | 'checks' | 'job' | 'eval' | 'activate';
export type WalkStep = { title: string; detail: string; nodes: LoopNode[]; chips: string[]; tone?: 'fail' | 'pass' };

export const walkthrough: WalkStep[] = [
  { title: 'Orders agent changes the API', detail: 'quoteTotal() now returns dollars, not cents.', nodes: ['agent'], chips: ['Orders rev 7 → 8'] },
  { title: 'Gateway checks the change', detail: 'Billing depends on rev 7, now stale. Allowed under current policy.', nodes: ['gateway'], chips: ['Billing @ rev 7 · stale', 'policy epoch 1'] },
  { title: 'Controlled checks run', detail: 'Billing consumer fails: totals off by 100×. A receipt records it.', nodes: ['checks'], chips: ['Billing ✕', 'receipt'], tone: 'fail' },
  { title: 'Improvement job proposes a rule', detail: '“A monetary-unit change requires the dependent service update plus passing checks.”', nodes: ['job'], chips: ['bounded rule'] },
  { title: 'Fixed evaluation replays history', detail: 'Past bad changes: blocked. Valid coordinated changes: allowed. Zero harm.', nodes: ['eval'], chips: ['bad → blocked', 'valid → allowed', 'harm 0'], tone: 'pass' },
  { title: 'Activation controller turns it on', detail: 'Only passing rules activate.', nodes: ['activate'], chips: ['policy epoch 1 → 2'], tone: 'pass' },
  { title: 'Next similar change is blocked early', detail: 'A currency-precision change is blocked at propose time, citing the original failure. Agents fix both services; checks pass.', nodes: ['agent', 'gateway', 'checks'], chips: ['blocked at propose', 'cites receipt', 'checks ✓'], tone: 'pass' },
  { title: 'The loop compounds', detail: 'More agents → more events → more rules → fewer collisions → more parallel agents.', nodes: ['agent', 'gateway', 'checks', 'job', 'eval', 'activate'], chips: ['recursive'] },
];
