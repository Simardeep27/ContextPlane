import assert from 'node:assert/strict';
import { it } from 'node:test';
import { staleVersionReasons, type DependencyRevisionRecord } from '@context-plane/contracts';
import { DurablePersistenceAdapter, MemoryStorage } from '@context-plane/persistence';
import * as fixture from '../src/fixture.js';
import { manifest, resetAndSeed } from '../src/seed.js';

async function snapshot(adapter: DurablePersistenceAdapter) {
  return {
    events: await adapter.readEvents(fixture.scope),
    dependency: await adapter.listRecords(fixture.scope, 'dependency_revision'),
    candidates: await adapter.listRecords(fixture.scope, 'candidate'),
    projection: await adapter.readProjection(fixture.scope),
  };
}

it('pins candidate, artifact, and dataset hashes across runs', () => {
  // Changing any fixture input must be a deliberate, reviewed change here.
  assert.equal(fixture.candidates.stale.candidateHash, 'sha256:792adbe6f60b9db26cac7732e45ca46aaf9614acf66bf8051de5d9586517bd3c');
  assert.equal(fixture.candidates.combined.candidateHash, 'sha256:21693595463f549c4d1edb9630b3ba912bfa23788e8f9b37e80139f9dc6d1401');
  assert.equal(fixture.artifacts.ordersContractNext.artifactHash, 'sha256:2883c98983ad4f961275eafffde963f9c5304cb4ef86a214b2cc757cb6e2929d');
  assert.equal(fixture.policyDatasetHash, 'sha256:74ceb377524da7e06c0453366ce35377fb679458a86453f6f6da676f8614f44d');
  assert.deepEqual(manifest(), manifest());
});

it('seeds dependency head N and Dev A candidate at N', async () => {
  const storage = new MemoryStorage(); const adapter = new DurablePersistenceAdapter(storage);
  await resetAndSeed(storage, adapter);
  const state = await snapshot(adapter);
  assert.deepEqual(state.events.map(e => e.type), ['dependency.published', 'candidate.proposed']);
  assert.equal(state.dependency[0]?.dependencyRevision, fixture.revisionN);
  assert.equal(state.candidates[0]?.candidateHash, fixture.candidates.stale.candidateHash);
  assert.equal(state.candidates[0]?.basedOn.dependencyRevision, fixture.revisionN);
  assert.equal(state.projection?.policyEpoch, fixture.initialPolicyEpoch);
});

it('re-running the command resets progress back to the identical seed', async () => {
  const storage = new MemoryStorage(); const adapter = new DurablePersistenceAdapter(storage);
  await resetAndSeed(storage, adapter);
  const first = await snapshot(adapter);
  // Simulate demo progress: Dev B's publication advances the head.
  const next: DependencyRevisionRecord = { ...fixture.seededDependency, revision: 2, dependencyRevision: fixture.revisionNext,
    artifactHash: fixture.artifacts.ordersContractNext.artifactHash, evidenceIds: [fixture.evidence.publishNext] };
  await adapter.saveRecord({ record: next, expectedRevision: 1 });
  assert.notDeepEqual(await snapshot(adapter), first);
  await resetAndSeed(storage, adapter);
  assert.deepEqual(await snapshot(adapter), first);
});

it('covers the stale candidate, corrected combined candidate, and publication', () => {
  const { stale, combined } = fixture.candidates;
  assert.notEqual(stale.candidateHash, combined.candidateHash);
  assert.equal(stale.expectedCheck.passed, false);
  assert.equal(combined.expectedCheck.passed, true);
  assert.equal(fixture.devBPublication.expectedRevision, fixture.revisionN);
  assert.equal(fixture.devBPublication.payload.dependencyRevision, fixture.revisionNext);
  // After publication the seeded candidate is stale; the combined one is current.
  const head = { dependencyRevision: fixture.revisionNext, policyEpoch: fixture.initialPolicyEpoch };
  assert.deepEqual(staleVersionReasons(fixture.seededCandidate.basedOn, { ...head, candidateHash: stale.candidateHash }),
    ['STALE_DEPENDENCY_REVISION']);
  assert.deepEqual(staleVersionReasons({ candidateHash: combined.candidateHash, dependencyRevision: combined.dependencyRevision,
    policyEpoch: fixture.initialPolicyEpoch }, { ...head, candidateHash: combined.candidateHash }), []);
});

it('policy dataset has unsafe, safe, and unrelated cases with the right expectations', () => {
  const kinds = new Set(fixture.policyDataset.map(c => c.kind));
  assert.deepEqual([...kinds].sort(), ['safe', 'unrelated', 'unsafe']);
  for (const c of fixture.policyDataset) {
    assert.equal(c.expected, c.kind === 'unsafe' ? 'require_ack' : 'allow', c.caseId);
  }
  const unrelated = fixture.policyDataset.filter(c => c.kind === 'unrelated');
  assert.ok(unrelated.every(c => c.facts.dependencyServiceId === null && c.facts.failure !== null));
  assert.equal(new Set(fixture.policyDataset.map(c => c.caseId)).size, fixture.policyDataset.length);
});

it('contains no credentials or real contact data', () => {
  const text = JSON.stringify({ ...fixture, manifest: manifest() });
  assert.doesNotMatch(text, /mongodb(\+srv)?:\/\/|password|secret|api[_-]?key|sk-[a-z0-9]{10}|@[a-z0-9-]+\.[a-z]{2,}/i);
});
