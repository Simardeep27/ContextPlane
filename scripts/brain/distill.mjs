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
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const COLLISION_WINDOW_MS = 30 * 60 * 1000;
const BODY_LIMIT = 4096;
const short = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const part = value => encodeURIComponent(String(value));
const day = iso => iso.slice(0, 10);
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Normalize one coordination message into a report; unparseable bodies become `note` reports. */
export function toReport(message) {
  let body = {};
  try { const parsed = JSON.parse(message.body); if (parsed && typeof parsed === 'object') body = parsed; } catch { /* free text */ }
  const occurredAt = typeof body.occurredAt === 'string' && !Number.isNaN(Date.parse(body.occurredAt))
    ? new Date(body.occurredAt).toISOString() : message.createdAt;
  return {
    sourceId: message.messageId,
    actor: typeof body.actor === 'string' ? body.actor : message.senderIdentity,
    instanceId: typeof body.instanceId === 'string' ? body.instanceId : 'unspecified',
    type: typeof body.type === 'string' ? body.type : 'note',
    task: typeof body.task === 'string' ? body.task : undefined,
    summary: typeof body.summary === 'string' ? body.summary : (typeof message.body === 'string' && !body.type ? message.body : ''),
    files: Array.isArray(body.files) ? body.files.filter(file => typeof file === 'string') : [],
    occurredAt,
  };
}

function withinBudget(header, lines) {
  const kept = [];
  let size = Buffer.byteLength(header);
  for (const line of lines) {
    const next = Buffer.byteLength(line) + 1;
    if (size + next > BODY_LIMIT - 64) { kept.push(`… ${lines.length - kept.length} more omitted`); break; }
    kept.push(line); size += next;
  }
  return [header, ...kept].join('\n');
}

function episodes(reports) {
  const sessions = new Map();
  for (const report of reports) {
    const key = `episode:${part(report.actor)}:${part(report.instanceId)}`;
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(report);
  }
  return [...sessions].map(([key, items]) => {
    const types = new Set(items.map(item => item.type));
    const outcome = types.has('work_finished') ? 'finished' : types.has('handoff') ? 'handed off'
      : types.has('blocked') ? 'blocked' : 'in progress';
    const task = items.map(item => item.task).filter(Boolean).at(-1) ?? 'unspecified task';
    const files = [...new Set(items.flatMap(item => item.files))].sort();
    const header = [`Actor: ${items[0].actor}; instance: ${items[0].instanceId}`, `Task: ${clip(task, 300)}`,
      `Outcome (self-reported, not verified): ${outcome}`, `Span: ${items[0].occurredAt} → ${items.at(-1).occurredAt}`,
      files.length ? `Files: ${clip(files.join(', '), 600)}` : 'Files: none reported', 'Timeline:'].join('\n');
    const lines = items.map(item => `- ${item.occurredAt} ${item.type}: ${clip(item.summary || '(no summary)', 300)} [${item.sourceId}]`);
    return { key, kind: 'episode', title: clip(`${items[0].actor} ${outcome}: ${task}`, 200),
      body: withinBudget(header, lines), sourceIds: items.map(item => item.sourceId).slice(-100) };
  });
}

function collisions(reports) {
  const pairs = new Map();
  const withFiles = reports.filter(report => report.files.length);
  for (let i = 0; i < withFiles.length; i++) {
    for (let j = i + 1; j < withFiles.length; j++) {
      const [a, b] = [withFiles[i], withFiles[j]];
      if (a.actor === b.actor) continue;
      if (Math.abs(Date.parse(a.occurredAt) - Date.parse(b.occurredAt)) > COLLISION_WINDOW_MS) continue;
      const shared = a.files.filter(file => b.files.includes(file));
      if (!shared.length) continue;
      const actors = [a.actor, b.actor].sort();
      const key = `insight:collision:${day(a.occurredAt < b.occurredAt ? a.occurredAt : b.occurredAt)}:${actors.map(part).join('+')}`;
      const entry = pairs.get(key) ?? { actors, files: new Set(), sources: new Set() };
      shared.forEach(file => entry.files.add(file)); entry.sources.add(a.sourceId); entry.sources.add(b.sourceId);
      pairs.set(key, entry);
    }
  }
  return [...pairs].map(([key, { actors, files, sources }]) => {
    const list = [...files].sort();
    return { key, kind: 'insight', title: clip(`Possible collision: ${actors.join(' and ')} reported the same files within 30 min`, 200),
      body: withinBudget(`${actors.join(' and ')} each reported touching these files within ${COLLISION_WINDOW_MS / 60000} minutes. ` +
        'Coordinate through work-status and send_message before further shared writes. Self-reported; not verified.\nShared files:',
      list.map(file => `- ${file}`)), sourceIds: [...sources].sort().slice(0, 100) };
  });
}

function finished(reports) {
  const days = new Map();
  for (const report of reports.filter(item => item.type === 'work_finished')) {
    const key = `insight:finished:${day(report.occurredAt)}`;
    const entry = days.get(key) ?? { day: day(report.occurredAt), actors: new Map() };
    if (!entry.actors.has(report.actor)) entry.actors.set(report.actor, []);
    entry.actors.get(report.actor).push(report);
    days.set(key, entry);
  }
  return [...days].map(([key, entry]) => {
    const actors = [...entry.actors.keys()].sort();
    const lines = actors.map(actor => `- ${actor}: ${entry.actors.get(actor).map(item => clip(item.task ?? item.summary ?? '', 160)).join('; ')}`);
    return { key, kind: 'insight', title: `${actors.length} agent${actors.length === 1 ? '' : 's'} finished tasks on ${entry.day}`,
      body: withinBudget(`Self-reported work_finished events on ${entry.day} (UTC). Verify against merged commits before relying on them.`, lines),
      sourceIds: actors.flatMap(actor => entry.actors.get(actor).map(item => item.sourceId)).sort().slice(0, 100) };
  });
}

/** Pure, deterministic derivation from coordination messages to keyed brain entries. */
export function distill(messages) {
  const reports = messages.map(toReport).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceId.localeCompare(b.sourceId));
  return [...episodes(reports), ...collisions(reports), ...finished(reports)]
    .map(item => ({ ...item, entryId: `${item.key}:${short([item.kind, item.title, item.body, item.sourceIds])}` }));
}

/** Append derived entries; skip unchanged ones and supersede the previous entry for the same key. */
export async function applyDistillation(brain, scope, author, derived, { dryRun = false } = {}) {
  const summary = { created: 0, unchanged: 0, superseding: 0 };
  for (const item of derived) {
    const previous = await brain.listByPrefix(scope, `${item.key}:`, 100);
    if (previous.some(entry => entry.entryId === item.entryId)) { summary.unchanged++; continue; }
    const supersedes = previous[0]?.entryId;
    if (supersedes) summary.superseding++;
    if (!dryRun) {
      await brain.remember({ scope, kind: item.kind, title: item.title, body: item.body, sourceIds: item.sourceIds,
        author, entryId: item.entryId, ...(supersedes ? { supersedes } : {}) });
    }
    summary.created++;
  }
  return summary;
}

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
