import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { people, type TeamSnapshot } from '../../shared/team.ts';
import { agentViews, groupByPerson, optimize, type AgentView, type OptimizerReport } from '../../shared/harness.ts';
import './team.css';
function when(value: string | null) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'}) : 'Not reported'; }
function ago(value: string | null, now: number) {
  if (!value) return 'no report time';
  const m = Math.floor((now - Date.parse(value)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
function AgentCard({agent,now}: {agent:AgentView;now:number}) {
  return <article className={`agent-card ${agent.status}`}>
    <div className="agent-card-top"><code title={agent.identity}>{agent.suffix}</code><span className={`chip chip-${agent.status}`}>{agent.status}</span></div>
    <p className="agent-task" title={agent.task ?? undefined}>{agent.task ?? 'Task not reported'}</p>
    <p className="agent-summary" title={agent.summary ?? undefined}>{agent.summary ?? 'No summary reported'}</p>
    <time dateTime={agent.updatedAt ?? undefined} title={when(agent.updatedAt)}>{ago(agent.updatedAt, now)}{agent.lastEventType ? ` · ${agent.lastEventType.replace('_',' ')}` : ''}</time>
  </article>;
}
function Optimizer({report}: {report:OptimizerReport}) {
  return <section className="optimizer" aria-labelledby="optimizer-title">
    <header><span className="pulse" aria-hidden="true"/><h2 id="optimizer-title">Harness optimizer · reads the ledger</h2><small>Suggestions are rule-based, computed from agent reports. No model is involved.</small></header>
    <p className="suggestion"><span>Next suggestion</span>{report.suggestion}</p>
    <dl className="stats">
      <div><dt>Events</dt><dd>{report.totalEvents}</dd></div><div><dt>Last hour</dt><dd>{report.eventsLastHour}</dd></div>
      <div><dt>Active</dt><dd>{report.active}</dd></div><div><dt>Blocked</dt><dd>{report.blocked}</dd></div>
      <div><dt>Finished</dt><dd>{report.finished}</dd></div><div><dt>Idle &gt;15m</dt><dd>{report.idle}</dd></div>
    </dl>
    <div className="findings">
      <div><h3>Collisions</h3>{report.collisions.length ? <ul>{report.collisions.map(c=><li key={`${c.a}|${c.b}`}><code>{c.a}</code> ↔ <code>{c.b}</code> · {c.subject}</li>)}</ul> : <p>None among active agents</p>}</div>
      <div><h3>Idle agents</h3>{report.idleAgents.length ? <ul>{report.idleAgents.map(a=><li key={a.identity}><code>{a.identity}</code> · {a.idleMinutes === null ? 'no report time' : `${a.idleMinutes}m`}</li>)}</ul> : <p>None</p>}</div>
    </div>
    {report.eventSource === 'surfaces' && <small className="source-caveat">Ledger messages are not in this read; event counts use work-status reports.</small>}
  </section>;
}
function TeamApp() {
  const [snapshot,setSnapshot]=useState<TeamSnapshot|null>(null);
  const [auth,setAuth]=useState<'checking'|'required'|'ready'>('checking');
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [now,setNow]=useState(Date.now());
  const [filter,setFilter]=useState('All'); const [password,setPassword]=useState('');
  const active=useRef<AbortController|null>(null);
  const signedOut=useRef(false);
  const refresh=useCallback(async()=>{
    if(active.current) return;
    const controller=new AbortController(); active.current=controller; setBusy(true);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const r=await fetch('/api/team',{cache:'no-store',signal:controller.signal});
      if(r.status===401){signedOut.current=true;setSnapshot(null);setAuth('required');setError('');return;}
      if(r.status===503) throw Error('Team access is not configured. Ask the deployment owner to finish setup.');
      if(!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw Error('Shared state is unavailable. Showing the last successful snapshot, if available.');
      const value=await r.json() as TeamSnapshot;
      if(!Array.isArray(value.agents)) throw Error('The team response could not be read.');
      signedOut.current=false;setSnapshot(value);setAuth('ready');setError('');setNow(Date.now());
    } catch(e) { if(!controller.signal.aborted || active.current===controller) setError(e instanceof Error && e.name !== 'AbortError' ? e.message === 'Failed to fetch' ? 'Connection lost. Showing the last successful snapshot, if available.' : e.message : 'Connection timed out. Showing the last successful snapshot, if available.'); }
    finally {clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{setNow(Date.now());if(!document.hidden && !signedOut.current) void refresh();},5000);
    const visible=()=>{if(!document.hidden && !signedOut.current) void refresh();};document.addEventListener('visibilitychange',visible);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};},[refresh]);
  async function login(e:FormEvent) {
    e.preventDefault();setBusy(true);setError('');
    try { const r=await fetch('/api/team',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      setPassword('');if(!r.ok) throw Error(r.status===401 ? 'That access password was not accepted.' : 'Sign-in is unavailable. Ask the deployment owner to check setup.');
      await refresh();
    } catch(e){setError(e instanceof Error ? e.message : 'Sign-in failed.');}finally{setBusy(false);}
  }
  async function logout(){
    active.current?.abort();active.current=null;
    try { const r=await fetch('/api/team',{method:'DELETE'});if(!r.ok) throw Error();signedOut.current=true;setSnapshot(null);setAuth('required');setError('');}
    catch {setError('Could not sign out. Please retry.');}
  }
  const views=useMemo(()=>snapshot?agentViews({agents:snapshot.agents,events:snapshot.events??[]},now):[],[snapshot,now]);
  const report=useMemo(()=>snapshot?optimize({agents:snapshot.agents,events:snapshot.events??[]},now):null,[snapshot,now]);
  const groups=groupByPerson(views).filter(g=>filter==='All'||g.person===filter);
  return <main className="team-shell">
    <header className="masthead"><a href="/" className="brand"><span className="brand-icon">C</span>Company Harness <span className="brand-suffix">/ Team</span></a><nav className="app-nav"><a href="/verified.html">Verified run</a><a href="/index.html">Migration HQ</a></nav><span className="private-label">Private workspace</span></header>
    <section className="intro"><div><p className="eyebrow">SHARED CONTEXT</p><h1>One team.<br/><span>A clear next move.</span></h1><p className="description">The work, blockers and next actions your agents have shared.</p></div>
      <aside className="source-note"><span className={`source-dot ${error?'offline':''}`}/><strong>{error?'Connection needs attention':snapshot?'Shared state connected':'Protected team view'}</strong><p>Agent reports, not verified completion or online presence.</p><small>Agents with no update for 15 minutes show as idle.</small></aside></section>
    {error && <div className="notice" role="alert">{error} <button onClick={()=>void refresh()} disabled={busy}>Retry</button></div>}
    {auth==='required' ? <form className="login" onSubmit={login}><p className="eyebrow">TEAM ACCESS</p><h2>Open the workspace</h2><p>Use the private viewer password supplied by your deployment owner.</p><input type="text" name="username" autoComplete="username" value="team" readOnly hidden/><label htmlFor="password">Viewer password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><button className="primary" disabled={busy}>Open team view</button></form> : <>
      <section className="toolbar"><div className="filters" aria-label="Filter by person">{['All',...people,...(views.some(a=>a.person==='Other')?['Other']:[])].map(p=><button key={p} aria-pressed={filter===p} onClick={()=>setFilter(p)}>{p}</button>)}</div><div className="refresh"><button onClick={()=>void refresh()} disabled={busy}>{busy?'Refreshing…':'↻ Refresh'}</button>{auth==='ready' && <button onClick={()=>void logout()}>Sign out</button>}</div></section>
      <div className="snapshot-meta" aria-live="polite"><span>{snapshot ? `${views.length} agents · ${report?.active ?? 0} active · ${report?.finished ?? 0} finished · ${report?.idle ?? 0} idle` : busy ? 'Reading shared state…' : 'No snapshot available'}</span><span>Last fetched {snapshot ? when(snapshot.fetchedAt) : 'never'} · refreshes every 5s</span></div>
      {snapshot?.possiblyTruncated && <p className="notice">The source returns the latest 100 surfaces. Older agent reports may be missing.</p>}
      {report && <Optimizer report={report}/>}
      {snapshot && <div className="people-columns" style={{'--cols':groups.length} as CSSProperties}>{groups.map(({person,agents})=>{
        const index=Math.max(0,people.indexOf(person as typeof people[number]));
        return <section className="person" key={person}><header className="person-heading"><span className={`avatar avatar-${person==='Other'?'other':index}`}>{person.slice(0,1)}</span><div><h2>{person}</h2><p>{agents.length} {agents.length===1?'agent':'agents'}</p></div></header>
          {agents.length ? agents.map(a=><AgentCard key={a.identity} agent={a} now={now}/>) : <div className="empty compact"><p>No work-status shared in the current source window.</p></div>}</section>;
      })}</div>}
    </>}
    <footer className="page-footer"><span>Company Harness · shared team state</span><span>Read only · Times shown in your timezone</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><TeamApp/></StrictMode>);
