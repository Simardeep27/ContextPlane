import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { people, personOf, type TeamSnapshot } from '../../shared/team.ts';
import { agentViews, groupByPerson, optimize, type AgentView, type OptimizerReport, type PersonResolver } from '../../shared/harness.ts';
import { sampleOrder, samplePersonOf, sampleSnapshot } from '../../shared/sample.ts';
import { BrainIcon, BrandMark } from '../ui/BrandMark.tsx';
import { AppNav } from '../ui/AppNav.tsx';
import { CompanyTree, LearningEpisodePanel, SampleEpisodePanel } from './Episode.tsx';
import './team.css';
type ViewMode = 'live' | 'sample';
const displayName = (p: string) => p === 'Buddh' ? 'Buddhsen' : p;
function when(value: string | null) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'}) : 'Not reported'; }
function ago(value: string | null, now: number) {
  if (!value) return 'no report time';
  const m = Math.floor((now - Date.parse(value)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
const chipLabel = (a: AgentView) => a.status === 'idle' && (a.idleMinutes ?? Infinity) <= 15 ? 'waiting' : a.status;
function AgentCard({agent,now}: {agent:AgentView;now:number}) {
  return <article className={`agent-card ${agent.status}`}>
    <div className="agent-card-top"><code title={agent.identity}>{agent.suffix}</code><span className={`chip chip-${agent.status}`}>{chipLabel(agent)}</span></div>
    <p className="agent-task" title={agent.task ?? undefined}>{agent.task ?? 'Task not reported'}</p>
    <p className="agent-summary" title={agent.summary ?? undefined}>{agent.summary ?? 'No summary reported'}</p>
    <time dateTime={agent.updatedAt ?? undefined} title={when(agent.updatedAt)}>{ago(agent.updatedAt, now)}{agent.lastEventType ? ` · ${agent.lastEventType.replace('_',' ')}` : ''}</time>
  </article>;
}
type Tool = { name: string; description?: string };
type OptimizeResult = { status: string; processing: { steps: string[]; message?: string };
  optimizedPrompt: { scenarioId: string; role: string; request: string; instructions: string[]; tools: Tool[];
    context: Record<'orgId'|'projectId'|'dependencyId'|'providerService'|'consumerService'|'dependencyRevision'|'policyEpoch', string | number> } };
const contextLabels: [keyof OptimizeResult['optimizedPrompt']['context'], string][] = [['orgId','Org'],['projectId','Project'],['dependencyId','Dependency'],['providerService','Provider'],['consumerService','Consumer'],['dependencyRevision','Dep. revision'],['policyEpoch','Policy epoch']];
function PromptOptimizer() {
  const [prompt,setPrompt]=useState('Change the Orders API to return monetary values in dollars.');
  const [level,setLevel]=useState<'low'|'medium'|'high'>('high');
  const [steps,setSteps]=useState<string[]>([]); const [shown,setShown]=useState(0);
  const [result,setResult]=useState<OptimizeResult|null>(null); const [running,setRunning]=useState(false); const [error,setError]=useState('');
  const run=useRef(0);
  async function submit(e:FormEvent){
    e.preventDefault(); const id=++run.current; setRunning(true); setError(''); setResult(null); setSteps([]); setShown(0);
    try {
      const r=await fetch('/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,optimizationLevel:level})});
      if(!r.ok) throw Error(r.status===400?'The optimizer rejected that input.':'The optimizer is unavailable. Retry in a moment.');
      const value=await r.json() as OptimizeResult; if(id!==run.current) return;
      setSteps(value.processing.steps);
      for(let i=1;i<=value.processing.steps.length;i++){ await new Promise(res=>setTimeout(res,550)); if(id!==run.current) return; setShown(i); }
      await new Promise(res=>setTimeout(res,300)); if(id===run.current) setResult(value);
    } catch(err){ if(id===run.current) setError(err instanceof Error?err.message:'Optimization failed.'); }
    finally { if(id===run.current) setRunning(false); }
  }
  return <section className="prompt-optimizer" aria-labelledby="po-title">
    <h3 id="po-title">Optimize a harness prompt</h3>
    <form onSubmit={submit} className="po-form">
      <label htmlFor="po-prompt" className="sr-only">Prompt</label>
      <textarea id="po-prompt" rows={2} value={prompt} maxLength={12000} required onChange={e=>setPrompt(e.target.value)}/>
      <div className="po-controls"><label htmlFor="po-level">Optimization</label>
        <select id="po-level" value={level} onChange={e=>setLevel(e.target.value as typeof level)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        <button className="po-submit" disabled={running||!prompt.trim()}>{running?'Optimizing…':'Optimize'}</button></div>
    </form>
    {error && <p className="po-error" role="alert">{error}</p>}
    {steps.length>0 && <ol className="po-steps" aria-live="polite">{steps.map((s,i)=><li key={s} className={i<shown?'done':i===shown&&running?'active':'pending'}><span aria-hidden="true">{i<shown?'✓':i===shown&&running?'●':'○'}</span>{s}</li>)}</ol>}
    {result && <div className="po-result">
      <div className="po-head"><span>Optimized prompt</span><code>{result.optimizedPrompt.scenarioId}</code><code>role: {result.optimizedPrompt.role}</code></div>
      <p className="po-request">{result.optimizedPrompt.request}</p>
      <dl className="po-context">{contextLabels.map(([k,l])=><div key={k}><dt>{l}</dt><dd>{String(result.optimizedPrompt.context[k])}</dd></div>)}</dl>
      <details><summary>{result.optimizedPrompt.instructions.length} instructions</summary><ul>{result.optimizedPrompt.instructions.map(i=><li key={i}>{i}</li>)}</ul></details>
      <div className="po-tools"><span>{result.optimizedPrompt.tools.length} tools</span>{result.optimizedPrompt.tools.map(t=><code key={t.name} title={t.description}>{t.name}</code>)}</div>
    </div>}
  </section>;
}
function Optimizer({report}: {report:OptimizerReport}) {
  return <section className="optimizer" aria-labelledby="optimizer-title">
    <header><span className="brain-badge"><BrainIcon/><span className="pulse" aria-hidden="true"/></span><h2 id="optimizer-title">Team activity</h2><small>Ledger stats are rule-based, computed from agent reports.</small></header>
    <div className="optimizer-grid">
      <div className="ledger">
        <p className="suggestion"><span>Next suggestion</span>{report.suggestion}</p>
        <dl className="stats">
          <div><dt>Events</dt><dd>{report.totalEvents}</dd></div><div><dt>Events / hour</dt><dd>{report.eventsLastHour}</dd></div>
          <div><dt>Active</dt><dd>{report.active}</dd></div><div><dt>Blocked</dt><dd>{report.blocked}</dd></div>
          <div><dt>Finished</dt><dd>{report.finished}</dd></div><div><dt>Idle</dt><dd>{report.idle}</dd></div>
        </dl>
        <div className="findings">
          <div><h3>Collisions · {report.collisions.length}</h3>{report.collisions.length ? <ul>{report.collisions.map(c=><li key={`${c.a}|${c.b}`}><code>{c.a}</code> ↔ <code>{c.b}</code> · {c.subject}</li>)}</ul> : <p>None among active agents</p>}</div>
          <div><h3>Idle / waiting</h3>{report.idleAgents.length ? <ul>{report.idleAgents.slice(0,5).map(a=><li key={a.identity}><code>{a.identity}</code> · {a.idleMinutes === null ? 'no report time' : `${a.idleMinutes}m`}</li>)}</ul> : <p>None</p>}</div>
        </div>
        {report.eventSource === 'surfaces' && <small className="source-caveat">Ledger messages are not in this read; event counts use work-status reports.</small>}
      </div>
    </div>
  </section>;
}
function People({views,order,now,label,team}:{views:AgentView[];order:readonly string[];now:number;label:(p:string)=>string;team?:(p:string)=>string}) {
  const groups=groupByPerson(views,order);
  return <div className="people-columns" style={{'--cols':groups.length} as CSSProperties}>{groups.map(({person,agents},index)=>
    <section className="person" key={person}><header className="person-heading"><span className={`avatar avatar-${person==='Other'?'other':index%4}`}>{label(person).slice(0,1)}</span><div><h2>{label(person)}</h2><p>{team?`${team(person)} · `:''}{agents.length} {agents.length===1?'agent':'agents'}</p></div></header>
      {agents.length ? agents.map(a=><AgentCard key={a.identity} agent={a} now={now}/>) : <div className="empty compact"><p>No work-status shared in the current source window.</p></div>}</section>)}</div>;
}
function TeamApp() {
  const [mode,setMode]=useState<ViewMode>(()=>location.hash==='#sample'?'sample':'live');
  const [snapshot,setSnapshot]=useState<TeamSnapshot|null>(null);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [now,setNow]=useState(Date.now());
  const active=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    if(active.current) return;
    const controller=new AbortController(); active.current=controller; setBusy(true);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const r=await fetch('/api/team',{cache:'no-store',signal:controller.signal});
      if(r.status===503) throw Error('Team access is not configured. Ask the deployment owner to finish setup.');
      if(!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw Error('Shared state is unavailable. Showing the last successful snapshot, if available.');
      const value=await r.json() as TeamSnapshot;
      if(!Array.isArray(value.agents)) throw Error('The team response could not be read.');
      setSnapshot(value);setError('');setNow(Date.now());
    } catch(e) { if(!controller.signal.aborted || active.current===controller) setError(e instanceof Error && e.name !== 'AbortError' ? e.message === 'Failed to fetch' ? 'Connection lost. Showing the last successful snapshot, if available.' : e.message : 'Connection timed out. Showing the last successful snapshot, if available.'); }
    finally {clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{setNow(Date.now());if(!document.hidden) void refresh();},5000);
    const visible=()=>{if(!document.hidden) void refresh();};document.addEventListener('visibilitychange',visible);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};},[refresh]);
  const switchMode=(m:ViewMode)=>{setMode(m);history.replaceState(null,'',m==='sample'?'#sample':location.pathname);};
  const sample=useMemo(()=>sampleSnapshot(now),[Math.floor(now/60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const source: {snap:TeamSnapshot|null;resolver:PersonResolver;order:readonly string[]} = mode==='sample'
    ? {snap:sample,resolver:samplePersonOf,order:sampleOrder} : {snap:snapshot,resolver:personOf,order:people};
  const views=useMemo(()=>source.snap?agentViews({agents:source.snap.agents,events:source.snap.events??[]},now,source.resolver):[],[source.snap,now,source.resolver]);
  const report=useMemo(()=>source.snap?optimize({agents:source.snap.agents,events:source.snap.events??[]},now,source.resolver):null,[source.snap,now,source.resolver]);
  const peopleCount=new Set(views.map(v=>v.person)).size;
  return <main className={`team-shell mode-${mode}`}>
    <header className="masthead"><a href="/" className="brand"><BrandMark size={30}/>Company Harness <span className="brand-suffix">/ Team</span></a><AppNav current="/team.html"/><span className="private-label">Read only</span></header>
    <section className="intro"><div><p className="eyebrow">SHARED CONTEXT</p><h1>One team.<br/><span>A clear next move.</span></h1></div>
      <div className="view-tabs" role="tablist" aria-label="Choose view">
        <button role="tab" aria-selected={mode==='live'} onClick={()=>switchMode('live')}><span className={`source-dot ${error?'offline':''}`}/>Our team <em>live + recorded</em></button>
        <button role="tab" aria-selected={mode==='sample'} onClick={()=>switchMode('sample')}>How it works · Office of the CTO <em className="sample-tag">sample</em></button>
      </div></section>
    {mode==='sample' ? <div className="sample-banner" role="note"><strong>SAMPLE DATA</strong> Fictional org of {sampleOrder.length} people across Platform, Payments and Growth, illustrating the ideal full learning loop. Illustrative numbers, not a live read or recorded result.</div>
      : error && <div className="notice" role="alert">{error} <button onClick={()=>void refresh()} disabled={busy}>Retry</button></div>}
    {source.snap && <CompanyTree views={views} order={source.order} label={mode==='sample'?(p=>p):displayName} company={mode==='sample'?'Office of the CTO':'ContextPlane'}/>}
    {mode==='sample' ? <SampleEpisodePanel/> : <LearningEpisodePanel/>}
    {mode==='live' && <details className="secondary"><summary>Details · agents, activity, prompt optimizer</summary>
      <div className="snapshot-meta" aria-live="polite"><span>{snapshot ? `${peopleCount} people · ${views.length} agents · ${report?.active ?? 0} active · ${report?.finished ?? 0} finished · ${report?.idle ?? 0} idle or waiting` : busy ? 'Reading shared state…' : 'No snapshot available'}</span>
        <span>Last fetched {snapshot ? when(snapshot.fetchedAt) : 'never'} · refreshes every 5s <button className="link" onClick={()=>void refresh()} disabled={busy}>{busy?'Refreshing…':'↻ Refresh'}</button></span></div>
      {snapshot?.possiblyTruncated && <p className="notice">The source returns the latest 100 surfaces. Older agent reports may be missing.</p>}
      {report && <Optimizer report={report}/>}
      {snapshot && <People views={views} order={source.order} now={now} label={displayName}/>}
      <PromptOptimizer/>
    </details>}
    <footer className="page-footer"><span>Company Harness · {mode==='sample'?'SAMPLE DATA':'shared team state'}</span><span>Agent reports, not verified completion · Stop = waiting, not finished · Times in your timezone</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><TeamApp/></StrictMode>);
