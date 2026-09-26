import { caveat, collisions, cumulative, mergeRates, minutesOf, snapshot, stats, windows } from '../../shared/architecture.ts';

const W = 680, H = 280, L = 40, R = 16, T = 18, B = 34;
const t0 = minutesOf('13:30'), t1 = minutesOf('17:40');
const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
const y = (n: number) => H - B - (n / 20) * (H - T - B);
const hhmm = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

export function Results() {
  const pts = cumulative();
  const rates = mergeRates();
  const live = minutesOf(snapshot.ledgerLive);
  let d = `M ${x(t0)} ${y(0)}`, prev = 0;
  for (const p of pts) { d += ` H ${x(p.t)} V ${y(p.n)}`; prev = p.n; }
  d += ` H ${x(minutesOf('17:30'))}`;
  const last = pts.at(-1);
  return <div className="results">
    <div className="chart-card">
      <header><h2>Cumulative merged PRs</h2><span className="snap">{snapshot.label}</span></header>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Step chart of ${prev} merged PRs from 13:38 to 17:28 EDT; ledger live at ${snapshot.ledgerLive}`}>
        <rect x={x(live)} y={T} width={x(live + windows.afterMinutes) - x(live)} height={H - T - B} className="after-band" />
        {[0, 5, 10, 15, 20].map((n) => <g key={n}><line x1={L} x2={W - R} y1={y(n)} y2={y(n)} className="grid" /><text x={L - 8} y={y(n) + 4} textAnchor="end" className="axis">{n}</text></g>)}
        {[14, 15, 16, 17].map((h) => <text key={h} x={x(h * 60)} y={H - 12} textAnchor="middle" className="axis">{h}:00</text>)}
        <line x1={x(live)} x2={x(live)} y1={T - 4} y2={H - B} className="marker" />
        <text x={x(live) + 6} y={T + 8} className="marker-t">ledger live {snapshot.ledgerLive}</text>
        <path d={d} className="step" />
        {pts.map((p) => <circle key={`${p.t}-${p.n}`} cx={x(p.t)} cy={y(p.n)} r={2.6} className="pt"><title>{`${hhmm(p.t)} EDT · ${p.n} merged`}</title></circle>)}
        {last && <text x={x(last.t) - 6} y={y(last.n) - 8} textAnchor="end" className="end-t">{last.n}</text>}
      </svg>
      <div className="rates">
        <div><span className="rate">{rates.beforePerHour}</span><small>merged PRs / h<br />before · {rates.before} over ~{windows.beforeHours} h</small></div>
        <span className="arrow" aria-hidden="true">→</span>
        <div className="after"><span className="rate">{rates.afterPerHour}</span><small>merged PRs / h<br />after · {rates.after} in first {windows.afterMinutes} min</small></div>
      </div>
    </div>
    <div className="tiles">
      {stats.map((s) => <div key={s.label} className="tile"><span>{s.value}</span><small>{s.label}</small></div>)}
      <div className="collisions"><small>pre-harness collisions</small><ul>{collisions.map((c) => <li key={c}>{c}</li>)}</ul></div>
    </div>
    <p className="caveat">{caveat}</p>
  </div>;
}
