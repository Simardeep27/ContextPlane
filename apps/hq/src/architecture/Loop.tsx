import { useEffect, useState } from 'react';
import { walkthrough, type LoopNode } from '../../shared/architecture.ts';

const nodes: { id: LoopNode; label: string; x: number; y: number }[] = [
  { id: 'agent', label: 'Orders agent', x: 200, y: 44 },
  { id: 'gateway', label: 'Gateway', x: 340, y: 124 },
  { id: 'checks', label: 'Checks · receipt', x: 340, y: 256 },
  { id: 'job', label: 'Improvement job', x: 200, y: 336 },
  { id: 'eval', label: 'Fixed evaluation', x: 60, y: 256 },
  { id: 'activate', label: 'Activation', x: 60, y: 124 },
];
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Loop() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(() => !reduced());
  const step = walkthrough[i]!;
  const n = walkthrough.length;
  useEffect(() => { if (!auto) return; const id = setInterval(() => setI((v) => (v + 1) % n), 4200); return () => clearInterval(id); }, [auto, n]);
  const go = (d: number) => { setAuto(false); setI((v) => (v + d + n) % n); };
  return <div className="loop">
    <p className="loop-label">Illustrative walkthrough (MVP scenario)</p>
    <div className="loop-grid">
      <svg viewBox="0 0 400 380" className="loop-svg" role="img" aria-label={`Loop diagram, step ${i + 1}: ${step.title}`}>
        <defs><marker id="lh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="ah" /></marker></defs>
        <circle cx={200} cy={190} r={128} className="ring" />
        {nodes.map((a, k) => { const b = nodes[(k + 1) % nodes.length]!; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; return <line key={a.id} x1={a.x + (mx - a.x) * 0.45} y1={a.y + (my - a.y) * 0.45} x2={mx + (b.x - mx) * 0.55} y2={my + (b.y - my) * 0.55} className="edge" markerEnd="url(#lh)" />; })}
        {nodes.map((nd) => { const on = step.nodes.includes(nd.id); return <g key={nd.id} className={`lnode${on ? ' on' : ''}${on && step.tone ? ` ${step.tone}` : ''}`}>
          <rect x={nd.x - 62} y={nd.y - 18} width={124} height={36} rx={18} /><text x={nd.x} y={nd.y + 4} textAnchor="middle">{nd.label}</text></g>; })}
        <text x={200} y={186} textAnchor="middle" className="epoch">policy epoch</text>
        <text x={200} y={214} textAnchor="middle" className="epoch-n">{i >= 5 ? 2 : 1}</text>
      </svg>
      <div className="step-panel">
        <ol className="dots" aria-label="Steps">{walkthrough.map((s, k) => <li key={s.title}><button aria-current={k === i ? 'step' : undefined} aria-label={`Step ${k + 1}: ${s.title}`} onClick={() => { setAuto(false); setI(k); }}>{k + 1}</button></li>)}</ol>
        <article key={i} className={`step ${step.tone ?? ''}`} aria-live="polite">
          <span className="step-n">Step {i + 1} / {n}</span>
          <h2>{step.title}</h2>
          <p>{step.detail}</p>
          <div className="chips">{step.chips.map((c) => <code key={c}>{c}</code>)}</div>
        </article>
        <div className="controls">
          <button onClick={() => go(-1)}>← Prev</button>
          <button onClick={() => go(1)}>Next →</button>
          <button className="toggle" aria-pressed={auto} onClick={() => setAuto((a) => !a)}>{auto ? 'Pause' : 'Autoplay'}</button>
        </div>
      </div>
    </div>
  </div>;
}
