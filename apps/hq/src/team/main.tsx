import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { freshness, people, type TeamAgent, type TeamSnapshot } from '../../shared/team.ts';
import './team.css';
function when(value: string | null) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'}) : 'Not reported'; }
function Agent({agent,now}: {agent:TeamAgent;now:number}) {
  const age = freshness(agent,now);
  return <article className="agent">
    <div className="agent-top"><code>{agent.identity}</code><span className={`badge ${age}`}>{age === 'recent' ? 'Recent report' : age === 'stale' ? 'Stale report' : 'Time unknown'}</span></div>
    <div className="reported-status">Reported · {agent.status.replace('_',' ')}</div>
    <h3>{agent.currentTask ?? 'Current task not reported'}</h3>
    <dl><div><dt>Task</dt><dd>{agent.task ?? 'Not reported'}</dd></div>
      <div><dt>Blockers</dt><dd>{agent.blockedOn.length ? <ul>{agent.blockedOn.map((x,i)=><li key={i}>{x}</li>)}</ul> : 'None reported'}</dd></div>
      <div><dt>Next action</dt><dd>{agent.nextAction ?? 'Not reported'}</dd></div></dl>
    <footer><time dateTime={agent.reportedAt ?? undefined}>Reported {when(agent.reportedAt)}</time><span>Revision {agent.revision ?? 'unknown'}</span></footer>
    <details><summary>Source details</summary><p>Published {when(agent.publishedAt)}</p><p>Instance <code>{agent.instanceId ?? 'not reported'}</code></p>
      <p>Source: work-status · team-context</p><p>Files: {agent.files.length ? agent.files.join(', ') : 'None reported'}</p>
      <p>Evidence references: {agent.evidence.length ? agent.evidence.join(' · ') : 'None reported'}</p>
    </details>
  </article>;
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
  const stale=snapshot?.agents.filter(a=>freshness(a,now)!=='recent').length ?? 0;
  return <main className="team-shell">
    <header className="masthead"><a href="/" className="brand"><span className="brand-icon">C</span>Company Harness <span className="brand-suffix">/ Team</span></a><nav className="app-nav"><a href="/verified.html">Verified run</a><a href="/index.html">Migration HQ</a></nav><span className="private-label">Private workspace</span></header>
    <section className="intro"><div><p className="eyebrow">SHARED CONTEXT</p><h1>One team.<br/><span>A clear next move.</span></h1><p className="description">The work, blockers and next actions your agents have shared.</p></div>
      <aside className="source-note"><span className={`source-dot ${error?'offline':''}`}/><strong>{error?'Connection needs attention':snapshot?'Shared state connected':'Protected team view'}</strong><p>Agent reports, not verified completion or online presence.</p><small>Reports become stale after 15 minutes.</small></aside></section>
    {error && <div className="notice" role="alert">{error} <button onClick={()=>void refresh()} disabled={busy}>Retry</button></div>}
    {auth==='required' ? <form className="login" onSubmit={login}><p className="eyebrow">TEAM ACCESS</p><h2>Open the workspace</h2><p>Use the private viewer password supplied by your deployment owner.</p><input type="text" name="username" autoComplete="username" value="team" readOnly hidden/><label htmlFor="password">Viewer password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><button className="primary" disabled={busy}>Open team view</button></form> : <>
      <section className="toolbar"><div className="filters" aria-label="Filter by person">{['All',...people,...(snapshot?.agents.some(a=>a.person==='Other')?['Other']:[])].map(p=><button key={p} aria-pressed={filter===p} onClick={()=>setFilter(p)}>{p}</button>)}</div><div className="refresh"><button onClick={()=>void refresh()} disabled={busy}>{busy?'Refreshing…':'↻ Refresh'}</button>{auth==='ready' && <button onClick={()=>void logout()}>Sign out</button>}</div></section>
      <div className="snapshot-meta" aria-live="polite"><span>{snapshot ? `${snapshot.agents.length} agent reports · ${stale} stale or unknown` : busy ? 'Reading shared state…' : 'No snapshot available'}</span><span>Last fetched {snapshot ? when(snapshot.fetchedAt) : 'never'} · refreshes every 5s</span></div>
      {snapshot?.possiblyTruncated && <p className="notice">The source returns the latest 100 surfaces. Older agent reports may be missing.</p>}
      {snapshot && <div className="people-grid">{[...people,...(snapshot.agents.some(a=>a.person==='Other')?['Other']:[])].filter(p=>filter==='All'||p===filter).map((person,index)=>{
        const agents=snapshot.agents.filter(a=>a.person===person);
        return <section className="person" key={person}><header className="person-heading"><span className={`avatar avatar-${index}`}>{person.slice(0,1)}</span><div><h2>{person}</h2><p>{agents.length} {agents.length===1?'agent report':'agent reports'}</p></div></header>
          {agents.length ? agents.map(a=><Agent key={a.identity} agent={a} now={now}/>) : <div className="empty"><span>○</span><h3>No work-status shared</h3><p>No report for this person appears in the current source window. Registration alone does not show activity.</p></div>}</section>;
      })}</div>}
    </>}
    <footer className="page-footer"><span>Company Harness · shared team state</span><span>Read only · Times shown in your timezone</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><TeamApp/></StrictMode>);
