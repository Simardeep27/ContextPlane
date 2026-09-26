import { useState } from 'react';

type Box = { id: string; x: number; y: number; w: number; h: number; title: string; sub?: string[]; tag?: string; hint: string; kind?: 'store' | 'improve' | 'plain' };

const people = ['Shivraj', 'Simar', 'Buddh', 'Tanish'];
const atlasCols: Box[] = [
  { id: 'coord', x: 794, y: 78, w: 122, h: 150, title: 'Coordination', sub: ['messages · inbox', 'work status', 'shared context'], hint: 'Who is doing what, and what they told each other.', kind: 'store' },
  { id: 'exec', x: 926, y: 78, w: 122, h: 150, title: 'Execution', sub: ['events · receipts', 'run checkpoints', 'rule versions', 'evaluations'], hint: 'What actually ran, what passed, and which rule version applied.', kind: 'store' },
  { id: 'brain', x: 1058, y: 78, w: 122, h: 150, title: 'Company brain', sub: ['principles', 'insights', 'episodes'], hint: 'Distilled lessons agents retrieve before acting.', kind: 'store' },
];
const top: Box[] = [
  { id: 'agents', x: 196, y: 60, w: 148, h: 176, title: 'Agents', sub: ['Codex · Claude', 'many per person'], hint: 'Each person runs several Codex and Claude sessions in parallel.' },
  { id: 'adapters', x: 374, y: 94, w: 150, h: 104, title: 'Client adapters', sub: ['installed hooks', 'durable local outbox'], hint: 'Hooks report every step; the outbox survives crashes and offline time.' },
  { id: 'gateway', x: 554, y: 94, w: 190, h: 104, title: 'Company MCP gateway', sub: ['domain tools', 'scoped checks'], tag: 'Cloudflare', hint: 'One door for agents: typed tools, scoped permissions, rule checks on propose.' },
  { id: 'steward', x: 782, y: 278, w: 190, h: 58, title: 'Context steward', sub: ['select relevant evidence'], hint: 'Picks the few records an agent needs instead of dumping the database.' },
  { id: 'ui', x: 992, y: 278, w: 190, h: 58, title: 'Team UI', sub: ['server-side reads'], tag: 'Vercel', hint: 'This page: reads Atlas on the server, never from the browser.' },
];
const bottom: Box[] = [
  { id: 'work', x: 16, y: 416, w: 196, h: 78, title: 'Controlled work', sub: ['exact revisions · checks'], hint: 'Every change runs against pinned revisions with fixed checks.', kind: 'improve' },
  { id: 'outcomes', x: 252, y: 416, w: 196, h: 78, title: 'Observed outcomes', sub: ['receipts · failures'], hint: 'Receipts record what passed and what broke.', kind: 'improve' },
  { id: 'evaluate', x: 488, y: 416, w: 196, h: 78, title: 'Evaluate rules', sub: ['fixed checks'], hint: 'Candidate rules replay history; any harm fails them.', kind: 'improve' },
  { id: 'job', x: 724, y: 416, w: 196, h: 78, title: 'Improvement job', sub: ['propose bounded rules'], hint: 'Turns observed failures into small, testable coordination rules.', kind: 'improve' },
  { id: 'activate', x: 960, y: 416, w: 196, h: 78, title: 'Activate version', sub: ['passing only'], hint: 'A new policy epoch goes live only when evaluation passes.', kind: 'improve' },
];
const peopleBox: Box = { id: 'people', x: 16, y: 60, w: 150, h: 176, title: 'People', hint: 'Four humans set goals and own acceptance.' };
const atlasBox: Box = { id: 'atlas', x: 780, y: 44, w: 414, h: 196, title: 'MongoDB Atlas', hint: 'The single durable record: coordination, execution and the company brain.', kind: 'store' };

export function Diagram() {
  const [active, setActive] = useState<Box | null>(null);
  const bind = (b: Box) => ({
    onMouseEnter: () => setActive(b), onMouseLeave: () => setActive(null), onFocus: () => setActive(b), onBlur: () => setActive(null),
    tabIndex: 0, role: 'img' as const, 'aria-label': `${b.title}: ${b.hint}`, className: `node ${b.kind ?? 'plain'}${active?.id === b.id ? ' on' : ''}`,
  });
  const box = (b: Box, small = false) => <g key={b.id} {...bind(b)}>
    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
    <text x={b.x + 14} y={b.y + 24} className={small ? 'n-title sm' : 'n-title'}>{b.title}</text>
    {b.tag && <g><rect x={b.x + b.w - 78} y={b.y + b.h - 26} width={66} height={18} rx={9} className="tag" /><text x={b.x + b.w - 45} y={b.y + b.h - 13} className="tag-t" textAnchor="middle">{b.tag}</text></g>}
    {b.sub?.map((s, i) => <text key={s} x={b.x + 14} y={b.y + (small ? 46 : 46) + i * 19} className="n-sub">{s}</text>)}
  </g>;
  return <figure className="diagram">
    <svg viewBox="0 0 1200 560" role="group" aria-label="Company Harness system architecture">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="ah" /></marker>
        <marker id="ah-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="ah-g" /></marker>
      </defs>
      <text x={16} y={30} className="row-label">TEAM COORDINATION</text>
      <text x={16} y={400} className="row-label">HARNESS IMPROVEMENT</text>

      {/* edges, drawn first */}
      {people.map((_, i) => <line key={i} x1={166} y1={104 + i * 34} x2={194} y2={104 + i * 34} className="edge" markerEnd="url(#ah)" />)}
      <line x1={354} y1={146} x2={372} y2={146} className="edge" markerEnd="url(#ah)" />
      <line x1={524} y1={146} x2={552} y2={146} className="edge" markerEnd="url(#ah)" />
      <line x1={744} y1={146} x2={778} y2={146} className="edge" markerStart="url(#ah)" markerEnd="url(#ah)" />
      <line x1={877} y1={242} x2={877} y2={276} className="edge" markerStart="url(#ah)" markerEnd="url(#ah)" />
      <line x1={1087} y1={276} x2={1087} y2={242} className="edge" markerEnd="url(#ah)" />
      <line x1={212} y1={455} x2={250} y2={455} className="edge g" markerEnd="url(#ah-g)" />
      <line x1={448} y1={455} x2={486} y2={455} className="edge g" markerEnd="url(#ah-g)" />
      <line x1={722} y1={455} x2={686} y2={455} className="edge g" markerEnd="url(#ah-g)" />
      <path d="M 822 494 L 822 514 L 1058 514 L 1058 496" className="edge g" markerEnd="url(#ah-g)" />
      <path d="M 1156 455 L 1184 455 L 1184 366 L 649 366 L 649 200" className="edge feedback" markerEnd="url(#ah-g)" />
      <text x={660} y={358} className="edge-label">updated coordination rules</text>

      {/* people */}
      <g {...bind(peopleBox)}>
        <rect x={peopleBox.x} y={peopleBox.y} width={peopleBox.w} height={peopleBox.h} rx={10} />
        <text x={30} y={84} className="n-title">People</text>
        {people.map((p, i) => <g key={p}><circle cx={40} cy={104 + i * 34} r={9} className={`dot d${i}`} /><text x={40} y={108 + i * 34} textAnchor="middle" className="dot-t">{p[0]}</text><text x={58} y={108 + i * 34} className="n-sub hi">{p}</text></g>)}
      </g>
      {/* agent stack */}
      <g {...bind(top[0]!)}>
        {[2, 1].map((o) => <rect key={o} x={196 + o * 5} y={60 - o * 5} width={148} height={176} rx={10} className="stack" />)}
        <rect x={196} y={60} width={148} height={176} rx={10} />
        <text x={210} y={84} className="n-title">Agents</text>
        {people.map((_, i) => <g key={i}>{[0, 1, 2].map((k) => <rect key={k} x={212 + k * 20} y={96 + i * 34} width={14} height={14} rx={3} className={`chipbox ${k % 2 ? 'claude' : 'codex'}`} />)}</g>)}
        <text x={278} y={108} className="n-sub">Codex</text><text x={278} y={142} className="n-sub">Claude</text>
        <text x={278} y={176} className="n-sub">× many</text>
      </g>
      {top.slice(1).map((b) => box(b, b.h < 60))}
      <g {...bind(atlasBox)}>
        <rect x={atlasBox.x} y={atlasBox.y} width={atlasBox.w} height={atlasBox.h} rx={12} />
        <text x={796} y={68} className="n-title">MongoDB Atlas</text>
      </g>
      {atlasCols.map((b) => box(b))}
      {bottom.map((b) => box(b))}

      <text x={600} y={548} textAnchor="middle" className="footer-t">Human permissions and acceptance checks remain fixed. Agents, models and workers execute outside MongoDB.</text>
    </svg>
    <figcaption aria-live="polite">{active ? <><strong>{active.title}</strong> {active.hint}</> : <span className="muted">Hover a box for detail</span>}</figcaption>
  </figure>;
}
