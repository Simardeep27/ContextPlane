import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cumulative, mergeRates, mergedPrs, minutesOf, snapshot, walkthrough } from './architecture.ts';

test('before/after merge rates derive from the timestamp data', () => {
  const r = mergeRates();
  assert.equal(r.before, 7);
  assert.equal(r.after, 8);
  assert.equal(r.beforePerHour, 1.4);
  assert.equal(r.afterPerHour, 6.4);
});

test('rates respond to the data rather than being constants', () => {
  const r = mergeRates([...mergedPrs, { time: '16:00' }]);
  assert.equal(r.afterPerHour, 7.2);
  assert.throws(() => minutesOf('nope'));
});

test('cumulative series is sorted, complete, and ends before the snapshot', () => {
  const c = cumulative();
  assert.equal(c.length, mergedPrs.length);
  assert.equal(c.at(-1)?.n, 20);
  assert.ok(c.every((p, i) => i === 0 || p.t >= c[i - 1]!.t));
  assert.ok((c.at(-1)?.t ?? Infinity) <= minutesOf('17:30'));
  assert.equal(snapshot.label, 'snapshot 17:30 EDT');
  assert.equal(walkthrough.length, 8);
});
