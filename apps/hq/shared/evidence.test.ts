import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { codeEvidence, evidenceRecord, type EvidenceRecord } from './evidence.ts';
const version = { candidateHash: 'sha256:abc', dependencyRevision: 7, policyEpoch: 1 };
function event(tool: string, result: object) { return { eventId: 'evt-one', type: `harness.${tool}.finished`, cursor: '000001',
  occurredAt: '2026-09-26T20:00:00.000Z', candidateVersion: version,
  payload: { tool, phase: 'finished', operationKey: 'op-one', result } }; }
test('evidence display never returns raw output, prompts, credentials, URLs or unknown policy fields', () => {
  const raw = event('policy_activated', { policy: { policyHash: 'sha256:policy', targetAgentId: 'agent-a', policyEpoch: 2,
    datasetHash: 'sha256:dataset', rule: { hiddenReasoning: 'PRIVATE_CANARY' }, token: 'PRIVATE_CANARY' },
    output: 'PRIVATE_CANARY', rawPrompt: 'PRIVATE_CANARY', evidenceIds: ['evidence-one','https://user:secret@private-host/'],
    evaluation: { passed: true, counts: { total: 5, correct: 5, unsafeAllowed: 0, validBlocked: 0 }, raw: 'PRIVATE_CANARY' } });
  const result = evidenceRecord(raw)!;
  assert.equal(result.policy?.passed, true); assert.equal(result.policy?.target, 'agent-a');
  assert.deepEqual(result.evidenceIds, ['evidence-one']);
  assert(!JSON.stringify(result).includes('PRIVATE_CANARY')); assert(!JSON.stringify(result).includes('private-host'));
  assert.equal(evidenceRecord({ ...raw, type: 'report.self_claim' }), null);
});
test('matching requires stage, passing check and publication for the same full version tuple', () => {
  const staged = evidenceRecord(event('stage_change', { stagedCandidate: { version } }))!;
  const tested = evidenceRecord(event('run_checks', { checkResult: { version, passed: true } }))!;
  const published = evidenceRecord(event('apply_change', { proof: { candidateHash: version.candidateHash, published: true } }))!;
  assert.equal(codeEvidence([staged,tested,published])[0]?.matches,true);
  assert.equal(codeEvidence([staged,{...tested,policyEpoch:2},published])[0]?.matches,false);
  assert.equal(codeEvidence([staged,{...tested,passed:false},published])[0]?.matches,false);
  assert.equal(codeEvidence([staged,tested,{...published,publishedHash:'sha256:different'}])[0]?.matches,false);
});
test('checked-in recording contains actual lifecycle, matching publication and causal receipts', () => {
  const recording = JSON.parse(readFileSync(new URL('../public/verification.json',import.meta.url),'utf8')) as { sourceCommit:string;records:EvidenceRecord[] };
  assert.equal(recording.sourceCommit,'715d3459c30d349bf065adae283e6f8e15dc37bf');
  assert.equal(codeEvidence(recording.records).filter(g => g.matches).length,2);
  assert.equal(recording.records.filter(r => r.action === 'policy_activated').length,1);
  assert.equal(recording.records.find(r => r.action === 'policy_evaluated')?.policy?.validBlocked,0);
  assert.deepEqual(recording.records.find(r => r.causalChecks.length)?.causalChecks.map(c => c.passed),[true,false,true]);
  assert(recording.records.some(r => r.allowed === false && r.reasons.includes('stale_dependency_revision')));
});
