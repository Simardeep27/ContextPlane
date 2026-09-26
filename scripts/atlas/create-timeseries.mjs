#!/usr/bin/env node
// Idempotent setup for the heartbeat time series (issue #55). A human runs this against
// team Atlas; agents only run it against a local database.
//
// Usage: node scripts/atlas/create-timeseries.mjs [--dry-run]
// Env:   MONGODB_URI, MONGODB_DATABASE (injected from Keychain, never passed as arguments).
//
// TTL scope: cp_agent_heartbeats expires samples after 7 days through the time-series
// expireAfterSeconds option. No other TTL index is created: run leases live as ISO strings
// inside project documents, and inbox leases live on cp_coordination_messages, which is
// the durable ledger and must never expire.
import { pathToFileURL } from 'node:url';

/** Plan the operations needed to reach the desired state; pure so tests can check it. */
export function plan(existing, spec) {
  const { name, options, indexes } = spec;
  const current = existing.collections.find(collection => collection.name === name);
  const steps = [];
  if (!current) {
    steps.push({ op: 'createCollection', name, options });
  } else {
    if (current.type !== 'timeseries') throw new Error('COLLECTION_NOT_TIMESERIES');
    const ts = current.options?.timeseries ?? {};
    if (ts.timeField !== options.timeseries.timeField || ts.metaField !== options.timeseries.metaField) {
      throw new Error('TIMESERIES_SHAPE_MISMATCH');
    }
    if (current.options?.expireAfterSeconds !== options.expireAfterSeconds) {
      steps.push({ op: 'collMod', name, expireAfterSeconds: options.expireAfterSeconds });
    }
  }
  const names = new Set(existing.indexes.map(index => index.name));
  for (const index of indexes) if (!names.has(index.name)) steps.push({ op: 'createIndex', name, index });
  return steps;
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI; const database = process.env.MONGODB_DATABASE;
  if (!uri || !database) throw new Error('MISSING_RUNTIME_SETTING MONGODB_URI_OR_DATABASE');
  const [{ MongoClient }, heartbeats] = await Promise.all([
    import('mongodb'), import('../../packages/mcp/dist/heartbeats.js')]);
  const spec = { name: heartbeats.HEARTBEAT_COLLECTION, options: heartbeats.heartbeatCollectionOptions,
    indexes: heartbeats.heartbeatIndexes };
  const client = new MongoClient(uri, { appName: 'context-plane-timeseries-setup', serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const db = client.db(database);
    const collections = await db.listCollections({ name: spec.name }).toArray();
    const indexes = collections.length ? await db.collection(spec.name).indexes() : [];
    const steps = plan({ collections, indexes }, spec);
    for (const step of dryRun ? [] : steps) {
      if (step.op === 'createCollection') await db.createCollection(step.name, step.options);
      if (step.op === 'collMod') await db.command({ collMod: step.name, expireAfterSeconds: step.expireAfterSeconds });
      if (step.op === 'createIndex') await db.collection(step.name).createIndex(step.index.key, { name: step.index.name });
    }
    console.log(JSON.stringify({ event: 'timeseries_setup', dryRun, collection: spec.name,
      steps: steps.map(step => step.op + (step.index ? `:${step.index.name}` : '')) }));
  } finally { await client.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error && /^[A-Z_]+( [A-Z_]+)?$/.test(error.message) ? error.message : 'TIMESERIES_SETUP_FAILED');
    process.exitCode = 1;
  });
}
