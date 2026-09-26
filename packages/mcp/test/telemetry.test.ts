import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { ProjectScope } from '@context-plane/contracts';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Client } from 'langsmith';
import { createApp } from '../src/app.js';
import { createTelemetry, type TraceRecord } from '../src/telemetry.js';

const scope = {orgId:'org_test',projectId:'project_test'} as ProjectScope;
const trace: TraceRecord = {id:'00000000-0000-4000-8000-000000000001',name:'mcp.tool.get_context',kind:'tool',startedAt:10,endedAt:20,metadata:{outcome:'success'}};

test('exports completed metadata-only traces and contains provider errors', async () => {
  const exported: Parameters<Client['createRun']>[0][]=[];
  const logs: Record<string,unknown>[]=[];
  const telemetry=createTelemetry({project:'test-project',client:{async createRun(run){exported.push(run);throw new Error('secret provider response');}},log:entry=>logs.push(entry)});
  telemetry.record(trace);
  await telemetry.flush();
  assert.equal(exported[0]?.project_name,'test-project');
  assert.deepEqual(exported[0]?.inputs,{});
  assert.deepEqual(exported[0]?.outputs,{status:'success'});
  assert.equal(exported[0]?.extra?.metadata?.duration_ms,10);
  assert.equal(logs[0]?.event,'langsmith_export_failed');
  assert.ok(!JSON.stringify(logs).includes('secret provider response'));
});

test('bounds pending exports and drops telemetry without blocking operations', async () => {
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const logs: Record<string,unknown>[]=[];
  let calls=0;
  const telemetry=createTelemetry({project:'test',maxPending:1,log:entry=>logs.push(entry),client:{async createRun(){calls++;await blocked;}}});
  telemetry.record(trace);telemetry.record({...trace,id:'another'});
  await Promise.resolve();
  assert.equal(calls,1);assert.equal(logs[0]?.event,'langsmith_trace_dropped');
  release();await telemetry.flush();
});

test('real MCP discovery, successes and errors trace without leaking arguments or results', async () => {
  const exported: Parameters<Client['createRun']>[0][]=[];
  const telemetry=createTelemetry({project:'test',client:{async createRun(run){exported.push(run);}}});
  const token='private-token-not-in-traces';
  const app=createApp({token,telemetry,principal:{scope,coordinationScope:'project:context-plane',identity:'server',allowedTools:['get_context','get_project_context']},ready:async()=>{},handlers:{
    get_context:{readOnly:true,execute:async()=>({body:'PRIVATE_RESULT_CONTENT'})},
    get_project_context:{readOnly:true,execute:async()=>{throw new Error('PRIVATE_STORAGE_ERROR');}},
  }});
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const url=new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const client=new McpClient({name:'test',version:'1.0'});
  try {
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
    await client.listTools();
    assert.ok(!(await client.callTool({name:'get_context',arguments:{identity:'PRIVATE_AGENT_VALUE',scope:'project:context-plane'}})).isError);
    assert.equal((await client.callTool({name:'get_context',arguments:{secret:'PRIVATE_ARGUMENT'}})).isError,true);
    assert.equal((await client.callTool({name:'get_project_context',arguments:{}})).isError,true);
    assert.equal((await client.callTool({name:'PRIVATE_TOOL_NAME',arguments:{}})).isError,true);
    await telemetry.flush();
    const serialized=JSON.stringify(exported);
    for(const secret of [token,'PRIVATE_AGENT_VALUE','PRIVATE_RESULT_CONTENT','PRIVATE_STORAGE_ERROR','PRIVATE_ARGUMENT','PRIVATE_TOOL_NAME']) assert.ok(!serialized.includes(secret),secret);
    assert.ok(exported.some(r=>r.name==='mcp.request.tools/list'));
    const tools=exported.filter(r=>r.run_type==='tool');
    assert.equal(tools.length,4);
    assert.equal(tools.filter(r=>r.error).length,3);
    assert.ok(tools.some(r=>r.error==='INVALID_INPUT'));
    assert.ok(tools.some(r=>r.error==='SERVICE_UNAVAILABLE'));
    for(const tool of tools) assert.ok(exported.some(r=>r.id===tool.parent_run_id));
  }finally{await client.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await telemetry.flush();}
});
