import { useEffect, useState } from 'react';
import { BrainIcon } from './BrandMark.tsx';
import './evaluator.css';
type Result={memory:{body:string;createdAt:string;entryId:string};model?:string;cached:boolean};
export function CompanyEvaluator(){
  const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [paused,setPaused]=useState(false);
  useEffect(()=>{let alive=true,active=false;const controller=new AbortController();
    async function run(){if(document.hidden||active||paused)return;active=true;setBusy(true);setError('');
      try{const r=await fetch('/api/evaluator',{method:'POST',signal:controller.signal});const d=await r.json();if(!r.ok)throw Error('Evaluator unavailable. Retrying next minute.');if(alive)setResult(d);}
      catch(e){if(alive)setError(e instanceof Error?e.message:'Evaluator unavailable');}finally{active=false;if(alive)setBusy(false);}}
    void run();const timer=setInterval(()=>void run(),60000);const visible=()=>void run();document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);controller.abort();};
  },[paused]);
  return <aside className="company-evaluator" aria-label="Company evaluator agent">
    <header><BrainIcon/><div><strong>Company evaluator</strong><small>DeepSeek · episodic memory</small></div><button onClick={()=>setPaused(!paused)}>{paused?'Resume':'Pause'}</button></header>
    <div className={`evaluator-bubble ${busy?'thinking':''}`} aria-live="polite"><strong>{busy?'Thinking about our latest work…':paused?'Paused':error?'Retry pending':'Watching team activity'}</strong>
      <p>{error||result?.memory.body||'Reading shared context and previous episodes…'}</p></div>
    <footer>{result?`Episode saved ${new Date(result.memory.createdAt).toLocaleTimeString()}`:'No saved evaluation yet'} · suggestions only</footer>
  </aside>;
}
