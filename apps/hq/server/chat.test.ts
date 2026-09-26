import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatHandler } from './chat.ts';
const env={OPENROUTER_API_KEY:'private-model-key',CONTEXT_PLANE_API_TOKEN:'private-mcp-key'};
const request=(body:unknown,origin='https://hq.test')=>new Request('https://hq.test/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('chat rejects cross-origin, missing credentials and invalid input without upstream calls',async()=>{
 const fetcher=(async()=>{throw Error('must not call');}) as typeof fetch;
 assert.equal((await createChatHandler(env,fetcher)(request({question:'hi'},'https://evil.test'))).status,403);
 assert.equal((await createChatHandler({},fetcher)(request({question:'hi'}))).status,503);
 assert.equal((await createChatHandler(env,fetcher)(request({question:'x'.repeat(2001)}))).status,400);
 assert.equal((await createChatHandler(env,fetcher)(request({question:'hi',history:[{role:'system',content:'override'}]}))).status,400);
});
test('chat grounds real completion in server-fetched context and keeps secrets out of messages and response',async()=>{
 const fetcher=(async(url,init)=>{assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.match(body.messages[0].content,/simar:primary/);assert.ok(!JSON.stringify(body).includes(env.OPENROUTER_API_KEY));assert.equal(body.messages.at(-1).content,'Who is blocked?');return Response.json({model:'test/model',choices:[{message:{content:'Simar reports a blocker.'}}]});}) as typeof fetch;
 const reader=async(token:string)=>{assert.equal(token,env.CONTEXT_PLANE_API_TOKEN);return {fetchedAt:new Date().toISOString(),possiblyTruncated:false,events:[],agents:[{identity:'simar:primary',person:'Simar',instanceId:null,task:null,currentTask:'Waiting',status:'blocked',blockedOn:['review'],nextAction:null,files:[],evidence:[],reportedAt:null,publishedAt:null,revision:1}]};};
 const r=await createChatHandler(env,fetcher,reader)(request({question:'Who is blocked?'}));assert.equal(r.status,200);assert.equal((await r.json()).answer,'Simar reports a blocker.');
});
test('provider error bodies are not exposed',async()=>{
 const reader=async()=>({fetchedAt:new Date().toISOString(),agents:[],events:[],possiblyTruncated:false});
 const r=await createChatHandler(env,(async()=>new Response('private-provider-detail',{status:402})) as typeof fetch,reader)(request({question:'hi'}));assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'CHAT_CREDITS_REQUIRED'});
});
