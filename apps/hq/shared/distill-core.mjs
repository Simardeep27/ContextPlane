// Pure, deterministic steward distillation shared by scripts/brain/distill.mjs
// (direct Mongo) and apps/hq/api/steward.ts (hosted MCP via Vercel Cron).
// No I/O: callers supply messages and a brain-like writer.
import { createHash } from 'node:crypto';

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

/** Convert a sanitized read_ledger event (hosted MCP projection) into the message shape toReport expects.
 * read_ledger drops actor, instanceId and occurredAt, so the sender and createdAt stand in for them. */
export function fromLedgerEvent(event) {
  const body = { type: event.type ?? undefined, summary: event.summary ?? undefined, task: event.task ?? undefined,
    files: Array.isArray(event.files) ? event.files : [] };
  return { messageId: event.messageId, senderIdentity: event.senderIdentity, createdAt: event.createdAt,
    body: event.type ? JSON.stringify(body) : '' };
}
