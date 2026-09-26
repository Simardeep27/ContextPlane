import { useEffect, useState } from 'react';
import './evaluator.css';
type Result={memory:{body:string;createdAt:string;entryId:string};model?:string;cached:boolean};
export function useCompanyEvaluator(){
  const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [paused,setPaused]=useState(false);
  useEffect(()=>{let alive=true,active=false;const controller=new AbortController();
    async function run(){if(document.hidden||active||paused)return;active=true;setBusy(true);setError('');
      try{const r=await fetch('/api/evaluator',{method:'POST',signal:controller.signal});const d=await r.json();if(!r.ok)throw Error('Evaluator unavailable. Retrying next minute.');if(alive)setResult(d);}
      catch(e){if(alive)setError(e instanceof Error?e.message:'Evaluator unavailable');}finally{active=false;if(alive)setBusy(false);}}
    void run();const timer=setInterval(()=>void run(),60000);const visible=()=>void run();document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);controller.abort();};
  },[paused]);
  const body=(result?.memory.body ?? '').replace(/[*`#]/g,'');
  const next=body.split(/Next action:?/i)[1]?.split(/Lesson:?/i)[0]?.trim();
  const short=(next || body.split('\n').filter(l=>l.trim()&&!/Observation/i.test(l))[0] || 'Reading team activity…').slice(0,125);
  return {result,busy,error,paused,setPaused,body,short,status:paused?'Paused':busy?'Thinking…':error?'Retrying shortly':'Watching'};
}
export type CompanyEvaluatorState=ReturnType<typeof useCompanyEvaluator>;
