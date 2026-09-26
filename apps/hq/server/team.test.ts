import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTeamHandler } from './team.ts';
import { createOptimizeHandler } from './optimize.ts';
const token='test-only-upstream-token';
const origin='https://team.example';
const env={CONTEXT_PLANE_API_TOKEN:token};
const request=(method='GET',headers:Record<string,string>={},body?:string,path='/api/team')=>new Request(`${origin}${path}`,{method,headers,...(body!==undefined?{body}:{})});
test('open read: no login, fails closed without token, rejects cross-origin and writes without upstream access',async()=>{
 let calls=0;const upstream:typeof fetch=async()=>{calls++;throw Error('should not run')};
 assert.equal((await createTeamHandler({},upstream)(request())).status,503);
 const handle=createTeamHandler(env,upstream);
 assert.equal((await handle(request('GET',{origin:'https://evil.example'}))).status,403);
 assert.equal((await handle(request('GET',{'sec-fetch-site':'cross-site'}))).status,403);
 for(const m of ['POST','DELETE','PATCH'])assert.equal((await handle(request(m,{origin}))).status,405);
 assert.equal(calls,0);
});
test('read without any cookie uses fixed server-only MCP scope, returns allowlisted data, disables caches',async()=>{
 let calls=0;const upstream:typeof fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://context-plane-brain.buddhsen-work.workers.dev/mcp');
  assert.equal((options?.headers as Record<string,string>).Authorization,`Bearer ${token}`);
  const body=JSON.parse(String(options?.body));assert.deepEqual(body.params,{name:'get_context',arguments:{identity:'shivraj:ui',scope:'project:context-plane'}});
  return Response.json({id:body.id,result:{structuredContent:{context:{surfaces:[],messages:[{identity:'a:1',body:JSON.stringify({type:'progress',actor:'a:1',occurredAt:new Date().toISOString(),uri:'mongodb+srv://secret',token})}]},secret:token}}});
 };
 const response=await createTeamHandler(env,upstream)(request());assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
 const body=await response.text();assert.ok(!body.includes(token));assert.ok(!body.includes('mongodb'));
 assert.deepEqual(JSON.parse(body).agents,[]);assert.equal(JSON.parse(body).events.length,1);assert.equal(calls,1);
});
test('MCP protocol, source and transport errors are surfaced without leaking bodies',async()=>{
 const thrown=await createTeamHandler(env,async()=>{throw Error(token)})(request());assert.equal(thrown.status,502);assert.ok(!(await thrown.text()).includes(token));
 for(const value of [{error:{message:token}},{result:{isError:true}},{result:{structuredContent:{context:null}}}]){
  const handle=createTeamHandler(env,async(_url,options)=>Response.json({id:JSON.parse(String(options?.body)).id,...value}));
  const response=await handle(request());assert.equal(response.status,502);assert.equal(await response.text(),'{"error":"TEAM_UNAVAILABLE"}');
 }
});
test('optimize route reuses the API harness optimizer and validates input',async()=>{
 const handle=createOptimizeHandler();const json={origin,'content-type':'application/json'};
 const ok=await handle(request('POST',json,JSON.stringify({prompt:'Change the Orders API to return monetary values in dollars.',optimizationLevel:'high'}),'/api/optimize'));
 assert.equal(ok.status,200);const body=await ok.json();
 assert.equal(body.status,'completed');assert.equal(body.processing.steps.length,3);
 assert.equal(body.optimizedPrompt.request,'Change the Orders API to return monetary values in dollars.');
 assert.deepEqual(Object.keys(body.optimizedPrompt.context).sort(),['consumerService','dependencyId','dependencyRevision','orgId','policyEpoch','projectId','providerService']);
 assert.ok(body.optimizedPrompt.tools.length>0&&body.optimizedPrompt.tools.every((t:{name?:string})=>typeof t.name==='string'));
 const low=await (await handle(request('POST',json,JSON.stringify({prompt:'x',optimizationLevel:'low'}),'/api/optimize'))).json();
 assert.ok(low.optimizedPrompt.tools.length>=body.optimizedPrompt.tools.length);
 assert.equal((await handle(request('POST',json,JSON.stringify({prompt:'',optimizationLevel:'high'}),'/api/optimize'))).status,400);
 assert.equal((await handle(request('POST',json,JSON.stringify({prompt:'x',optimizationLevel:'max'}),'/api/optimize'))).status,400);
 assert.equal((await handle(request('POST',json,'{bad','/api/optimize'))).status,400);
 assert.equal((await handle(request('GET',{},undefined,'/api/optimize'))).status,405);
 assert.equal((await handle(request('POST',{...json,origin:'https://evil.example'},'{}','/api/optimize'))).status,403);
});
