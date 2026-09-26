#!/usr/bin/env node
// Context steward distillation (ONTOLOGY.md "Context steward", "Derived context").
// Reads recent cp_coordination_messages for one scope and appends derived
// `episode` and `insight` entries to cp_brain_entries through the brain
// repository. Deterministic: no model calls. Idempotent: a rerun over the same
// messages writes nothing; changed input writes a new entry that supersedes the
// previous one for the same key. Source messages are never modified.
//
// Usage: node scripts/brain/distill.mjs [--since-hours 24] [--dry-run]
// Env: MONGODB_URI, MONGODB_DATABASE, CONTEXT_PLANE_ORG_ID, CONTEXT_PLANE_PROJECT_ID,
//      CONTEXT_PLANE_COORDINATION_SCOPE, optional CONTEXT_PLANE_STEWARD_IDENTITY.
import { pathToFileURL } from 'node:url';
import { applyDistillation, distill } from '../../apps/hq/shared/distill-core.mjs';

export { COLLISION_WINDOW_MS, applyDistillation, distill, toReport } from '../../apps/hq/shared/distill-core.mjs';

function setting(name) {
  const value = process.env[name];
  if (!value || value.length > 1024) throw new Error(`MISSING_RUNTIME_SETTING ${name}`);
  return value;
}

async function main(argv) {
  const sinceIndex = argv.indexOf('--since-hours');
  const sinceHours = sinceIndex >= 0 ? Number(argv[sinceIndex + 1]) : 24;
  if (!Number.isFinite(sinceHours) || sinceHours <= 0 || sinceHours > 24 * 30) throw new Error('INVALID_SINCE_HOURS');
  const dryRun = argv.includes('--dry-run');
  const [{ MongoClient }, { MongoBrainRepository }] = await Promise.all([
    import('mongodb'), import('../../packages/mcp/dist/brain.js')]);
  const scope = { orgId: setting('CONTEXT_PLANE_ORG_ID'), projectId: setting('CONTEXT_PLANE_PROJECT_ID') };
  const coordinationScope = setting('CONTEXT_PLANE_COORDINATION_SCOPE');
  const author = process.env.CONTEXT_PLANE_STEWARD_IDENTITY ?? 'steward:context';
  const client = new MongoClient(setting('MONGODB_URI'), { appName: 'context-plane-steward', serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const db = client.db(setting('MONGODB_DATABASE'));
    const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
    const messages = await db.collection('cp_coordination_messages').find({ ...scope, coordinationScope,
      createdAt: { $gte: since } }, { projection: { _id: 0, messageId: 1, senderIdentity: 1, body: 1, createdAt: 1 } })
      .sort({ createdAt: 1 }).limit(5000).toArray();
    const brain = new MongoBrainRepository(db, scope);
    if (!dryRun) await brain.initialize();
    const result = await applyDistillation(brain, coordinationScope, author, distill(messages), { dryRun });
    console.log(JSON.stringify({ event: 'brain_distilled', dryRun, messages: messages.length, ...result }));
  } finally { await client.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error && /^[A-Z_]+( [A-Z_]+)?$/.test(error.message) ? error.message : 'DISTILL_FAILED');
    process.exitCode = 1;
  });
}
