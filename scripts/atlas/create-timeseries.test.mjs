import test from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_COLLECTION, heartbeatCollectionOptions, heartbeatIndexes } from '../../packages/mcp/dist/heartbeats.js';
import { plan } from './create-timeseries.mjs';

const spec = { name: HEARTBEAT_COLLECTION, options: heartbeatCollectionOptions, indexes: heartbeatIndexes };

test('plan creates the collection and index on an empty database', () => {
  assert.deepEqual(plan({ collections: [], indexes: [] }, spec).map(step => step.op), ['createCollection', 'createIndex']);
});

test('plan is idempotent once the desired state exists, and repairs only the TTL', () => {
  const current = { name: HEARTBEAT_COLLECTION, type: 'timeseries', options: { ...heartbeatCollectionOptions } };
  assert.deepEqual(plan({ collections: [current], indexes: [{ name: 'scope_identity_ts' }] }, spec), []);
  const stale = { ...current, options: { ...current.options, expireAfterSeconds: 60 } };
  assert.deepEqual(plan({ collections: [stale], indexes: [{ name: 'scope_identity_ts' }] }, spec),
    [{ op: 'collMod', name: HEARTBEAT_COLLECTION, expireAfterSeconds: 604_800 }]);
});

test('plan refuses to reuse a regular collection', () => {
  assert.throws(() => plan({ collections: [{ name: HEARTBEAT_COLLECTION, type: 'collection' }], indexes: [] }, spec),
    /COLLECTION_NOT_TIMESERIES/);
});
