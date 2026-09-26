import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GraphInput } from './graph.ts';
import { impactOf } from './impact.ts';

const svc = (id: string) => ({ serviceId: id, label: id, owner: null, source: 'seed' as const });
const surf = (id: string, serviceId: string) => ({ surfaceId: id, serviceId, label: id, detail: '', revision: 1, source: 'seed' as const });
const dep = (surfaceId: string, consumer: string) => ({ dependencyId: `${surfaceId}->${consumer}`, surfaceId,
  consumerServiceId: consumer, verifiedRevision: 1, verifiedEpoch: null, source: 'seed' as const });

// a:s -> b, b:s -> c, c:s -> d (3 hops) and d:s -> a (cycle back to the provider).
const input: GraphInput = { services: ['a', 'b', 'c', 'd'].map(svc),
  surfaces: ['a', 'b', 'c', 'd'].map(s => surf(`${s}:s`, s)),
  dependencies: [dep('a:s', 'b'), dep('b:s', 'c'), dep('c:s', 'd'), dep('d:s', 'a'), dep('d:s', 'b')], runs: [], changes: [] };

test('impactOf follows a 3-hop chain and stops at cycles', () => {
  const impact = impactOf(input, 'a:s');
  assert.equal(impact.source, 'seed');
  assert.deepEqual([...impact.hits.values()].map(h => [h.serviceKey, h.depth, h.path.join('>')]),
    [['b', 1, 'a>b'], ['c', 2, 'a>b>c'], ['d', 3, 'a>b>c>d']]);
  assert.equal(impact.hits.has('a'), false);
});

test('impactOf honours maxDepth and unknown surfaces', () => {
  assert.deepEqual([...impactOf(input, 'a:s', 1).hits.keys()], ['b']);
  assert.equal(impactOf(input, 'missing').hits.size, 0);
});
