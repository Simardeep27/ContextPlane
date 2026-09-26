import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceRecord } from '../../shared/evidence.ts';
import { buildTree, countNodes, graphFromEvidence, mergeInputs, visibleRows,
  type GraphChange, type GraphRun, type GraphSource, type TreeNode } from '../../shared/graph.ts';
import { BrandMark } from '../ui/BrandMark.tsx';
import { sampleGraph } from './sample.ts';
import './graph.css';

interface Recording { sourceCommit: string; observedAt: string; projectId: string; records: EvidenceRecord[] }
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: Recording };

const SOURCE_LABEL: Record<GraphSource, string> = { recorded: 'RECORDED', seed: 'SEED', sample: 'SAMPLE', live: 'LIVE' };
const short = (hash: string | null) => (hash ? hash.replace(/^sha256:/, '').slice(0, 8) : '');
const time = (iso: string, source: GraphSource) => {
  if (!iso) return 'time not recorded';
  const d = new Date(iso);
  return source === 'recorded' ? `${d.toISOString().slice(11, 23)}Z` : d.toISOString().slice(0, 16).replace('T', ' ');
};
const rev = (n: number | null, prefix = 'r') => (n === null ? '—' : `${prefix}${n}`);

/** Per-source time domain: recorded evidence and SAMPLE fixtures never share an axis. */
function domains(tree: TreeNode[]) {
  const acc = new Map<GraphSource, [number, number]>();
  const add = (src: GraphSource, iso: string) => {
    const t = Date.parse(iso); if (!Number.isFinite(t)) return;
    const d = acc.get(src); acc.set(src, d ? [Math.min(d[0], t), Math.max(d[1], t)] : [t, t]);
  };
  const walk = (n: TreeNode) => {
    n.runs.forEach(r => { add(r.source, r.startedAt); add(r.source, r.finishedAt); });
    n.changes.forEach(c => add(c.source, c.at)); n.children.forEach(walk);
  };
  tree.forEach(walk);
  return acc;
}

export function Graph() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [showSample, setShowSample] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/verification.json', { signal: abort.signal })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Recording>; })
      .then(data => setLoad({ state: 'ready', data }))
      .catch(() => { if (!abort.signal.aborted) setLoad({ state: 'error' }); });
    return () => abort.abort();
  }, []);

  const tree = useMemo(() => {
    const recorded = load.state === 'ready' ? graphFromEvidence(load.data.records) : null;
    const parts = [recorded, showSample ? sampleGraph() : null].filter((p): p is NonNullable<typeof p> => p !== null);
    return parts.length ? buildTree(mergeInputs(...parts)) : [];
  }, [load, showSample]);
  const rows = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);
  const scale = useMemo(() => domains(tree), [tree]);
  const all = useMemo(() => { const out: TreeNode[] = []; const w = (n: TreeNode) => { out.push(n); n.children.forEach(w); }; tree.forEach(w); return out; }, [tree]);
  const selectedNode = all.find(n => n.id === selected) ?? null;
  const counts = { total: countNodes(tree), stale: all.filter(n => n.kind === 'consumer' && n.status === 'stale').length,
    blocked: all.filter(n => n.kind === 'consumer' && n.status === 'blocked').length };

  const toggle = (id: string) => setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const recDomain = scale.get('recorded');

  return <main className="graph-page">
    <header className="graph-top">
      <a href="/" className="graph-brand"><BrandMark size={28} />Company Harness <span>/ Dependencies</span></a>
      <nav className="graph-nav"><a href="/verified.html">Verified run</a><a href="/team.html">Team</a><a href="/index.html">Live HQ</a><a href="/architecture.html">Architecture</a></nav>
    </header>

    <section className="graph-intro">
      <div>
        <h1>Dependency graph</h1>
        <p>Functionalities as a tree: service → versioned surface → consumer. Rows show the revision each consumer last
          verified, whether the surface changed since, and runs that executed against an older revision.</p>
      </div>
      <dl className="graph-sources" aria-label="Data sources">
        <div><dt><span className="src src--recorded">RECORDED</span></dt><dd>
          {load.state === 'ready' ? <>Run evidence <code>verification.json</code> · observed {new Date(load.data.observedAt).toISOString().slice(0, 19)}Z ·{' '}
            <a href={`https://github.com/Simardeep27/ContextPlane/commit/${load.data.sourceCommit}`}>source {load.data.sourceCommit.slice(0, 7)}</a></>
            : load.state === 'error' ? 'Recorded evidence could not be loaded.' : 'Loading recorded evidence…'}</dd></div>
        <div><dt><span className="src src--seed">SEED</span></dt><dd>Service names, owners and <code>dependency_orders_billing</code> from the MVP-02 scenario seed</dd></div>
        <div><dt><span className="src src--sample">SAMPLE</span></dt><dd>
          <label><input type="checkbox" checked={showSample} onChange={e => setShowSample(e.target.checked)} /> Illustrative fixtures for density, not real work</label></dd></div>
        <div><dt><span className="src src--off">LIVE</span></dt><dd>Not connected. This view has no live read route yet.</dd></div>
      </dl>
    </section>

    <div className="graph-summary">
      <span>{counts.total} nodes</span><span className="chip chip--stale">{counts.stale} stale consumers</span>
      <span className="chip chip--blocked">{counts.blocked} blocked</span>
      <button onClick={() => setCollapsed(new Set())}>Expand all</button>
      <button onClick={() => setCollapsed(new Set(tree.map(t => t.id)))}>Collapse all</button>
    </div>

    <div className={`graph-body${selectedNode ? ' graph-body--panel' : ''}`}>
      <div className="trace" role="treegrid" aria-label="Dependency tree">
        <div className="trace-head" role="row">
          <span role="columnheader">Functionality</span><span role="columnheader">Revision</span>
          <span role="columnheader">Status</span><span role="columnheader">Used by / consumer</span>
          <span role="columnheader" className="trace-axis">
            {recDomain ? <><span>{time(new Date(recDomain[0]).toISOString(), 'recorded')}</span><span>recorded run timeline</span>
              <span>{time(new Date(recDomain[1]).toISOString(), 'recorded')}</span></> : <span>timeline</span>}
          </span>
        </div>
        {rows.map(node => <Row key={node.id} node={node} open={!collapsed.has(node.id)} selected={node.id === selected}
          domain={scale.get(node.source === 'seed' ? 'recorded' : node.source)}
          onToggle={() => toggle(node.id)} onSelect={() => setSelected(node.id === selected ? null : node.id)}
          onHover={(e) => setHover(e ? { node, ...e } : null)} />)}
        {showSample && <p className="trace-foot">SAMPLE rows use their own time scale. Recorded rows span {recDomain ? `${((recDomain[1] - recDomain[0]) / 1000).toFixed(2)} s` : '—'} of one verification run.</p>}
      </div>
      {selectedNode && <DetailPanel node={selectedNode} onClose={() => setSelected(null)} />}
    </div>
    {hover && <HoverCard {...hover} />}
  </main>;
}

function Row({ node, open, selected, domain, onToggle, onSelect, onHover }: {
  node: TreeNode; open: boolean; selected: boolean; domain: [number, number] | undefined;
  onToggle: () => void; onSelect: () => void; onHover: (p: { x: number; y: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) onHover({ x: r.left + 24 + node.depth * 18, y: r.bottom }); };
  return <div ref={ref} role="row" aria-level={node.depth + 1} aria-expanded={node.children.length ? open : undefined}
    aria-selected={selected} tabIndex={0} className={`trace-row trace-row--${node.kind}${selected ? ' is-selected' : ''}`}
    onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect(); if (e.key === ' ' && node.children.length) { e.preventDefault(); onToggle(); } }}
    onMouseEnter={show} onMouseLeave={() => onHover(null)} onFocus={show} onBlur={() => onHover(null)}>
    <span className="cell-name" style={{ paddingLeft: node.depth * 18 }}>
      {node.children.length ? <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'}
        onClick={e => { e.stopPropagation(); onToggle(); }}>{open ? '▾' : '▸'}</button> : <span className="twisty-spacer" />}
      <span className={`kind kind--${node.kind}`} aria-hidden>{node.kind === 'service' ? 'SVC' : node.kind === 'surface' ? 'API' : 'USE'}</span>
      <span className="name-text" title={`${node.label} · ${node.detail}`}><strong>{node.label}</strong><small>{node.detail}</small></span>
      {node.source !== 'recorded' && <span className={`src src--${node.source}`}>{SOURCE_LABEL[node.source]}</span>}
    </span>
    <span className="cell-rev mono">
      {node.kind === 'surface' && rev(node.revision)}
      {node.kind === 'consumer' && <>{rev(node.verifiedRevision)}{node.changed && <span className="delta" title="Surface changed since this consumer last verified"> → {rev(node.currentRevision)}</span>}</>}
      {node.kind === 'service' && <span className="muted">{node.children.length} surface{node.children.length === 1 ? '' : 's'}</span>}
    </span>
    <span className="cell-status">
      <span className={`chip chip--${node.status}`}>{node.status}</span>
      {node.changed && <span className="changed-dot" title="Changed since consumer last verified" aria-label="changed" />}
      {node.staleRuns.length > 0 && <span className="stale-count" title="Runs against an older revision">{node.staleRuns.length} stale run{node.staleRuns.length === 1 ? '' : 's'}</span>}
    </span>
    <span className="cell-used">
      {node.usedBy.slice(0, 2).map(u => <span key={u.consumer} className={`badge${u.revision !== null && node.revision !== null && u.revision < node.revision ? ' badge--behind' : ''}`}>
        used by {u.consumer} @ {rev(u.revision, 'rev ')}</span>)}
      {node.usedBy.length > 2 && <span className="badge">+{node.usedBy.length - 2}</span>}
      {node.kind === 'consumer' && <span className="muted small">verified {rev(node.verifiedRevision)} of {rev(node.currentRevision)}</span>}
    </span>
    <span className="cell-time"><Spans node={node} domain={domain} /></span>
  </div>;
}

function Spans({ node, domain }: { node: TreeNode; domain: [number, number] | undefined }) {
  if (!domain) return <svg className="spans" aria-hidden />;
  const [a, b] = domain; const span = Math.max(1, b - a);
  const pct = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - a) / span) * 100));
  const lanes = node.kind === 'service' ? [] : node.runs;
  return <svg className="spans" viewBox="0 0 100 20" preserveAspectRatio="none" role="img"
    aria-label={`${node.runs.length} runs, ${node.changes.length} changes`}>
    <line x1="0" x2="100" y1="10" y2="10" className="spans-axis" />
    {node.kind === 'service' && node.runs.length > 0 &&
      <rect x={pct(node.runs[0]!.startedAt)} width={Math.max(0.6, pct(node.runs.at(-1)!.finishedAt) - pct(node.runs[0]!.startedAt))} y="7" height="6" rx="1" className="span span--envelope" />}
    {lanes.map(r => { const x = pct(r.startedAt); const w = Math.max(0.6, pct(r.finishedAt) - x);
      const stale = node.staleRuns.includes(r);
      return <rect key={r.runId} x={x} width={w} y="5" height="10" rx="1" className={`span span--${r.outcome}${stale ? ' span--stale' : ''}`} />; })}
    {node.changes.map(c => <rect key={c.changeId} x={pct(c.at) - 0.5} width="1" y="1" height="18" className={`mark mark--${c.kind}`} />)}
  </svg>;
}

function RunLine({ run, current }: { run: GraphRun; current: number | null }) {
  return <li className="run-line">
    <code title={run.runId}>{run.runId}</code>
    <span className="mono">{rev(run.dependencyRevision)} <span className="muted">vs</span> {rev(current)}</span>
    <span className={`outcome outcome--${run.outcome}`}>{run.outcome}</span>
    <span className="muted">{time(run.startedAt, run.source)}</span>
    <span className="muted">{run.agent ?? 'agent not recorded'}</span>
  </li>;
}

function HoverCard({ node, x, y }: { node: TreeNode; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y + 6 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth; const h = el.offsetHeight; const pad = 12;
    const left = Math.min(Math.max(pad, x), window.innerWidth - w - pad);
    const below = y + 6; const top = below + h + pad > window.innerHeight ? Math.max(pad, y - h - 44) : below;
    setPos({ left, top });
  }, [x, y, node.id]);
  const current = node.kind === 'service' ? null : node.currentRevision;
  const list = node.staleRuns.slice(-5).reverse();
  return <div ref={ref} className="hover-card" role="tooltip" style={pos}>
    <header><strong>{node.label}</strong><span className={`src src--${node.source}`}>{SOURCE_LABEL[node.source]}</span></header>
    <p className="muted small">{node.staleRuns.length
      ? `${node.staleRuns.length} stale run${node.staleRuns.length === 1 ? '' : 's'}: executed against a revision older than current`
      : 'No stale runs. Every run used the current revision.'}</p>
    {list.length > 0 && <ul>{list.map(r => <RunLine key={r.runId + r.nodeId} run={r} current={current ?? currentFor(node, r)} />)}</ul>}
    {node.staleRuns.length > list.length && <p className="muted small">+{node.staleRuns.length - list.length} older · click row for all</p>}
  </div>;
}

/** Service rows aggregate several surfaces; look up the surface that owns the run. */
function currentFor(node: TreeNode, run: GraphRun): number | null {
  for (const s of node.children) if (s.runs.includes(run)) return s.currentRevision;
  return null;
}

function DetailPanel({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const history = node.changes.filter(c => c.toRevision !== null);
  const other = node.changes.filter(c => c.toRevision === null);
  return <aside className="detail" aria-label={`${node.label} details`}>
    <header><div><small className="muted">{node.kind}</small><h2>{node.label}</h2><small className="muted">{node.detail}</small></div>
      <button onClick={onClose} aria-label="Close details">×</button></header>
    <dl className="detail-facts">
      <dt>Status</dt><dd><span className={`chip chip--${node.status}`}>{node.status}</span></dd>
      <dt>Source</dt><dd><span className={`src src--${node.source}`}>{SOURCE_LABEL[node.source]}</span></dd>
      {node.kind !== 'service' && <><dt>Current</dt><dd className="mono">{rev(node.currentRevision)}</dd></>}
      {node.kind === 'consumer' && <><dt>Verified</dt><dd className="mono">{rev(node.verifiedRevision)}{node.changed ? ' · changed since' : ''}</dd></>}
      {node.usedBy.length > 0 && <><dt>Used by</dt><dd>{node.usedBy.map(u => `${u.consumer} @ ${rev(u.revision, 'rev ')}`).join(', ')}</dd></>}
    </dl>
    <h3>Version history</h3>
    {history.length ? <ol className="history">{history.map(c => <ChangeItem key={c.changeId} change={c} />)}</ol>
      : <p className="muted small">No revision changes recorded for this node.</p>}
    <h3>Changes</h3>
    {other.length ? <ol className="history">{other.map(c => <ChangeItem key={c.changeId} change={c} />)}</ol>
      : <p className="muted small">No other changes recorded.</p>}
    <h3>Runs ({node.runs.length})</h3>
    <ul className="detail-runs">{node.runs.slice().reverse().map(r => <RunLine key={r.runId + r.nodeId} run={r}
      current={node.kind === 'service' ? currentFor(node, r) : node.currentRevision} />)}</ul>
  </aside>;
}

function ChangeItem({ change: c }: { change: GraphChange }) {
  return <li>
    <span className="mono">{c.fromRevision !== null && c.toRevision !== null ? `${rev(c.fromRevision)} → ${rev(c.toRevision)}` : c.kind}</span>
    <span>{c.summary}</span>
    <span className="muted small">{c.actor ?? 'actor not recorded'} · {time(c.at, c.source)}{c.hash ? <> · <code>{short(c.hash)}</code></> : null}</span>
  </li>;
}
