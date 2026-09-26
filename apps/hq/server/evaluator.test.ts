import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluatorHandler} from './evaluator.ts';
const env={OPENROUTER_API_KEY:'private-model-key',CONTEXT_PLANE_API_TOKEN:'private-mcp-key'};
const req=(origin='https://hq.test')=>new Request('https://hq.test/api/evaluator',{method:'POST',headers:{Origin:origin}});
const reader=async()=>({fetchedAt:new Date().toISOString(),agents:[],events:[],possiblyTruncated:false});
test('evaluator denies cross-origin and absent credentials before upstream work',async()=>{
 const fail=async()=>{throw Error('must not run');};
 assert.equal((await createEvaluatorHandler(env,fetch,reader,fail)(req('https://evil.test'))).status,403);
 assert.equal((await createEvaluatorHandler({},fetch,reader,fail)(req())).status,503);
});
test('evaluator persists derived episodes and reuses unchanged input without another model call',async()=>{
 const entries:unknown[]=[];let completions=0;
 const call=async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_context')return {context:{}};
  if(name==='recall')return {entries};
  assert.equal(name,'remember');assert.equal(args.kind,'episode');
  const entry={entryId:args.entry_id,body:args.body,author:'company:evaluator',createdAt:'2026-01-01T00:00:00Z'};entries.push(entry);return entry;
 };
 const fetcher=(async(_url,init)=>{completions++;const body=JSON.parse(String(init?.body));assert.equal(body.model,'deepseek/deepseek-v4.1-flash');assert.ok(!JSON.stringify(body).includes(env.OPENROUTER_API_KEY));return Response.json({choices:[{message:{content:'Check stale reports before assigning work.'}}]});}) as typeof fetch;
 const handler=createEvaluatorHandler(env,fetcher,reader,call);
 const first=await handler(req());assert.equal(first.status,200);assert.equal((await first.json()).cached,false);
 const second=await handler(req());assert.equal((await second.json()).cached,true);assert.equal(completions,1);assert.equal(entries.length,1);
});
test('evaluator cooldown avoids new inference and provider errors never become stored memories',async()=>{
 let saved=false;
 const recent=async(name:string)=>name==='get_context'?{context:{}}:{entries:[{entryId:'prior',author:'company:evaluator',body:'Prior lesson',createdAt:new Date().toISOString()}]};
 const fail=(async()=>{throw Error('must not run');}) as typeof fetch;
 assert.equal((await createEvaluatorHandler(env,fail,reader,recent)(req())).status,200);
 const call=async(name:string)=>{if(name==='remember')saved=true;return name==='get_context'?{context:{}}:{entries:[]};};
 const r=await createEvaluatorHandler(env,(async()=>new Response('provider secret',{status:402})) as typeof fetch,reader,call)(req());
 assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'EVALUATOR_UNAVAILABLE'});assert.equal(saved,false);
});
