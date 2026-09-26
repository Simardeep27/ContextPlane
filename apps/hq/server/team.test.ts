import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTeamHandler, readTeam } from './team.ts';
const password='test-only-viewer-password-at-least-24';
const token='test-only-upstream-token';
const origin='https://team.example';
const env={HQ_VIEW_PASSWORD:password,CONTEXT_PLANE_API_TOKEN:token,VERCEL:'1'};
const request=(method='GET',headers:Record<string,string>={},body?:string)=>new Request(`${origin}/api/team`,{method,headers,...(body!==undefined?{body}:{})});
async function login(handle:ReturnType<typeof createTeamHandler>){
 const r=await handle(request('POST',{origin,'content-type':'application/json'},JSON.stringify({password})));
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')!;
 assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/Secure/);assert.ok(!cookie.includes(password));
 return cookie.split(';')[0]!;
}
test('fails closed when misconfigured, unauthenticated, cross-origin or wrong method without upstream access',async()=>{
 let calls=0;const upstream:typeof fetch=async()=>{calls++;throw Error('should not run')};
 for(const config of [{},{...env,HQ_VIEW_PASSWORD:'short'},{...env,HQ_VIEW_PASSWORD:token}])assert.equal((await createTeamHandler(config,upstream)(request())).status,503);
 const handle=createTeamHandler(env,upstream);
 assert.equal((await handle(request())).status,401);
 assert.equal((await handle(request('GET',{cookie:'hq_team_session=forged'}))).status,401);
 assert.equal((await handle(request('GET',{origin:'https://evil.example'}))).status,403);
 assert.equal((await handle(request('POST',{'content-type':'application/json'},JSON.stringify({password})))).status,403);
 assert.equal((await handle(request('POST',{origin,'content-type':'application/json'},JSON.stringify({password:'wrong'})))).status,401);
 assert.equal((await handle(request('POST',{origin,'content-type':'application/json'},'x'.repeat(5000)))).status,413);
 assert.equal((await handle(request('PATCH'))).status,405);assert.equal(calls,0);
});
test('authenticated read uses fixed server-only MCP scope, returns allowlisted data, disables caches',async()=>{
 let calls=0;const upstream:typeof fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://context-plane-brain.buddhsen-work.workers.dev/mcp');
  assert.equal((options?.headers as Record<string,string>).Authorization,`Bearer ${token}`);
  assert.equal((options?.headers as Record<string,string>).Origin,undefined);
  const body=JSON.parse(String(options?.body));
  if(body.params.name==='read_ledger'){assert.equal(body.params.arguments.identity,'shivraj:ui');assert.equal(body.params.arguments.scope,'project:context-plane');
   return Response.json({id:body.id,result:{structuredContent:{events:[{messageId:'m1',senderIdentity:'simar:primary',createdAt:'2026-09-26T16:00:00Z',type:'progress',summary:'ok',task:null,files:['a.ts'],body:token}]}}});}
  assert.deepEqual(body.params,{name:'get_context',arguments:{identity:'shivraj:ui',scope:'project:context-plane'}});
  return Response.json({id:body.id,result:{structuredContent:{context:{surfaces:[]},secret:token}}});
 };
 const handle=createTeamHandler(env,upstream);const cookie=await login(handle);
 const response=await handle(request('GET',{cookie}));assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');
 const body=await response.text();assert.ok(!body.includes(token));assert.ok(!body.includes(password));assert.deepEqual(JSON.parse(body).agents,[]);assert.equal(calls,2);
 assert.equal(JSON.parse(body).eventsAvailable,true);assert.deepEqual(JSON.parse(body).events.map((e:{messageId:string})=>e.messageId),['m1']);
 const logout=await handle(request('DELETE',{origin,cookie}));assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/);
});
test('expired, tampered and rotated sessions fail; upstream errors never leak bodies',async()=>{
 let now=Date.now();const handle=createTeamHandler(env,async()=>{throw Error(token)},()=>now);const cookie=await login(handle);
 assert.equal((await handle(request('GET',{cookie:cookie+'x'}))).status,401);
 const failed=await handle(request('GET',{cookie}));assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes(token));
 assert.equal((await createTeamHandler({...env,HQ_VIEW_PASSWORD:password+'rotated'})(request('GET',{cookie}))).status,401);
 now+=9*60*60*1000;assert.equal((await handle(request('GET',{cookie}))).status,401);
});
test('MCP protocol and source errors are surfaced without stale success',async()=>{
 for(const value of [{error:{message:token}},{result:{isError:true}},{result:{structuredContent:{context:null}}}]){
  const handle=createTeamHandler(env,async(_url,options)=>Response.json({id:JSON.parse(String(options?.body)).id,...value}));
  const response=await handle(request('GET',{cookie:await login(handle)}));assert.equal(response.status,502);assert.equal(await response.text(),'{"error":"TEAM_UNAVAILABLE"}');
 }
});
test('team view falls back when the deployed MCP lacks read_ledger',async()=>{
 const upstream:typeof fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));
  return body.params.name==='read_ledger'?Response.json({id:body.id,result:{isError:true,content:[{type:'text',text:'TOOL_UNAVAILABLE'}]}})
   :Response.json({id:body.id,result:{structuredContent:{context:{surfaces:[]}}}});};
 const value=await readTeam('t'.repeat(32),upstream);
 assert.deepEqual(value.events,[]);assert.equal(value.eventsAvailable,false);assert.deepEqual(value.agents,[]);
});
