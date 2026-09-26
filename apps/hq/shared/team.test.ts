import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshness, projectTeam } from './team.ts';
const now = new Date('2026-09-26T20:00:00Z');
const surface = (ownerIdentity: string, content: unknown, revision=1) => ({ownerIdentity,content,revision,surfaceName:'work-status',kind:'team-context',coordinationScope:'project:context-plane',updatedAt:now.toISOString()});
test('projects real surfaces, preserves concurrent identities, aliases Buddh, and omits non-status/private fields',()=>{
 const result=projectTeam({context:{surfaces:[surface('shivraj:ui',{person:'Shivraj',currentTask:'UI',updatedAt:now.toISOString(),secret:'not exposed'}),surface('shivraj:primary',{currentTask:'Coordinator'}),surface('codex:nyny',{person:'Buddhsen',blockedOn:['Needs review']}),{...surface('x',{}),surfaceName:'private'}],agent:{metadata:{secret:'no'}}}},now);
 assert.equal(result.agents.length,3); assert.equal(result.agents[0]?.person,'Buddh');
 assert.equal(result.agents.filter(a=>a.person==='Shivraj').length,2);
 assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('not exposed'));
 assert.equal(result.agents.find(a=>a.identity==='shivraj:primary')?.currentTask,'Coordinator');
});
test('missing, stale, future, malformed and duplicate reports remain honest',()=>{
 const result=projectTeam({context:{surfaces:[surface('a',{updatedAt:'bad'}),surface('b',{updatedAt:'2026-09-26T19:30:00Z'}),surface('c',{updatedAt:'2099-01-01T00:00:00Z'}),surface('a',{currentTask:'new'},2),{...surface('d',{}),coordinationScope:'other'}]}},now);
 assert.equal(result.agents.length,3);assert.equal(result.agents[0]?.currentTask,'new');
 assert.deepEqual(result.agents.map(a=>freshness(a,now.getTime())),['unknown','stale','unknown']);
 assert.deepEqual(projectTeam({context:{surfaces:[]}},now).agents,[]);
 assert.throws(()=>projectTeam({context:null},now));
 assert.equal(projectTeam({context:{surfaces:Array.from({length:100},()=>surface('same',{}))}},now).possiblyTruncated,true);
});
