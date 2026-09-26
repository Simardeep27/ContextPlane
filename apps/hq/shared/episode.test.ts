import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { learningEpisode } from './episode.ts';
import type { EvidenceRecord } from './evidence.ts';

const recorded = JSON.parse(readFileSync(new URL('../public/verification.json', import.meta.url), 'utf8')).records as EvidenceRecord[];

test('recorded run yields the full learning episode', () => {
  const ep = learningEpisode(recorded);
  assert.equal(ep.activeEpoch, 1); assert.equal(ep.candidateEpoch, 2);
  assert.equal(ep.rule?.status, 'Active');
  assert.match(ep.rule!.text, /agent_dev_b_billing/);
  assert.deepEqual(ep.evaluation && [ep.evaluation.correct, ep.evaluation.total], [5, 5]);
  assert.ok(ep.stages.every(s => s.fact !== null));
  assert.match(ep.stages[4]!.fact!, /completion not yet measured/);
  assert.equal(ep.metrics.find(m => m.label === 'Cost')?.value, null);
});

test('missing evidence stays unmeasured instead of invented', () => {
  const ep = learningEpisode(recorded.filter(r => !r.policy));
  assert.equal(ep.rule, null); assert.equal(ep.evaluation, null); assert.equal(ep.candidateEpoch, null);
  assert.equal(ep.stages[1]!.fact, null); assert.equal(ep.stages[4]!.fact, null);
});

test('candidate-only rule is labelled Candidate', () => {
  const ep = learningEpisode(recorded.filter(r => r.action !== 'policy_evaluated' && r.action !== 'policy_activated' && r.action !== 'learn'));
  assert.equal(ep.rule?.status, 'Candidate');
});
