import * as fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const limits = { pending: 256, seen: 4096, bytes: 2 * 1024 * 1024 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) throw Error('UNSAFE_OUTBOX');
  fs.chmodSync(dir, 0o700);
}
function atomic(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
// Locks never expire during an in-flight network write. Recovery is explicit and
// refuses a live PID; run recover only after stopping all clients for this outbox.
export async function locked(dir, name, action, waitMs = 5000) {
  const lock = path.join(dir, name + '.lock'); const deadline = Date.now() + waitMs;
  while (true) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw Error('OUTBOX_BUSY_OR_INTERRUPTED');
      await sleep(20);
    }
  }
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 });
  try { return await action(); }
  finally { fs.unlinkSync(path.join(lock, 'pid')); fs.rmdirSync(lock); }
}
export function recoverLocks(dir) {
  for (const name of ['state', 'delivery', 'allocation']) {
    const lock = path.join(dir, name + '.lock');
    if (!fs.existsSync(lock)) continue;
    const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw Error('LOCK_OWNER_UNKNOWN');
    try { process.kill(pid, 0); throw Error('LOCK_OWNER_ALIVE'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(path.join(lock, 'pid')); fs.rmdirSync(lock);
  }
}
export class Outbox {
  constructor(root, config, budget = limits, lockWaitMs = 5000) {
    privateDir(root);
    this.config = config; this.budget = budget; this.lockWaitMs = lockWaitMs;
    this.dir = path.join(root, digest(config.identity));
    if (!fs.existsSync(this.dir)) {
      const allocation = path.join(root, 'allocation.lock');
      try { fs.mkdirSync(allocation, { mode: 0o700 }); } catch { throw Error('OUTBOX_BUSY_OR_INTERRUPTED'); }
      fs.writeFileSync(path.join(allocation, 'pid'), String(process.pid), { mode: 0o600 });
      try {
        if (fs.readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name)).length >= 64) throw Error('OUTBOX_FULL');
        privateDir(this.dir);
      } finally { fs.unlinkSync(path.join(allocation, 'pid')); fs.rmdirSync(allocation); }
    } else privateDir(this.dir);
    this.file = path.join(this.dir, 'state.json');
  }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, config: this.config, sequence: 0, terminal: false, pending: [], seen: [] };
    if (fs.lstatSync(this.file).isSymbolicLink()) throw Error('UNSAFE_OUTBOX');
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (JSON.stringify(state.config) !== JSON.stringify(this.config)) throw Error('OUTBOX_IDENTITY_CONFLICT');
    return state;
  }
  async mutate(action) {
    return locked(this.dir, 'state', () => {
      // Incomplete atomic writes were never acknowledged; the prior state remains authoritative.
      for (const name of fs.readdirSync(this.dir)) {
        if (/^state\.json\.[0-9a-f-]+\.tmp$/.test(name)) fs.unlinkSync(path.join(this.dir, name));
      }
      const state = this.read(); const result = action(state);
      if (state.pending.length > this.budget.pending || state.seen.length > this.budget.seen ||
          Buffer.byteLength(JSON.stringify(state)) > this.budget.bytes) throw Error('OUTBOX_FULL');
      atomic(this.file, state); return result;
    }, this.lockWaitMs);
  }
  async enqueue(observation) {
    return this.mutate(state => {
      const heartbeat = observation.kind === 'Heartbeat';
      // Check under the same lock as Stop/SessionEnd so a timer cannot reopen
      // a stopped session. Older spool versions wait for a fresh native event.
      if (heartbeat && (state.terminal || !state.activity || state.activity.status === 'stopped' ||
          state.pending.length)) return null;
      const eventId = `${this.config.identity}:${digest(observation.key).slice(0, 32)}`;
      if (state.seen.includes(eventId)) return eventId;
      const sequence = ++state.sequence; const occurredAt = new Date().toISOString();
      const stale = state.terminal && observation.kind !== 'SessionStart';
      const status = heartbeat ? state.activity.status : observation.kind === 'SessionEnd' || observation.kind === 'Stop' ? 'stopped'
        : observation.kind === 'PostToolUseFailure' ? 'blocked' : 'working';
      if (observation.kind === 'SessionStart') state.terminal = false;
      if (observation.kind === 'SessionEnd') state.terminal = true;
      const event = { eventId, type: heartbeat ? 'heartbeat' : observation.kind === 'SessionStart' ? 'work_started' :
        observation.kind === 'PostToolUseFailure' ? 'blocked' : status === 'stopped' ? 'work_finished' : 'progress',
        actor: this.config.identity, instanceId: this.config.instanceId, sessionId: this.config.sessionId,
        task: this.config.task, sequence, occurredAt, evidenceKind: 'client_observation',
        summary: observation.summary, outcomeVerified: false, stale };
      const content = { person: this.config.person, instanceId: this.config.instanceId, sessionId: this.config.sessionId,
        task: this.config.task, currentTask: observation.summary, status, sequence, files: [], completed: [],
        blockedOn: status === 'blocked' ? ['Client reported tool failure; outcome not inspected'] : [],
        nextAction: status === 'working' ? 'Continue authorized work' : 'Review client outcome before claiming completion',
        lastEventId: eventId, updatedAt: occurredAt, evidence: [], outcomeVerified: false };
      if (heartbeat) {
        Object.assign(content, { currentTask: state.activity.summary, lastActivityAt: state.activity.at,
          heartbeatAt: occurredAt, heartbeatIntervalSeconds: 60 });
        Object.assign(event, { lastActivityAt: state.activity.at, heartbeatAt: occurredAt });
        state.lastHeartbeatAt = occurredAt;
      } else if (!stale) {
        state.activity = { status, summary: observation.summary, at: occurredAt };
        content.lastActivityAt = occurredAt;
      }
      state.pending.push({ eventId, message: { identity: this.config.identity, scope: this.config.scope,
        recipient: this.config.recipient, message_id: eventId, body: JSON.stringify(event), evidence_ids: [] },
        surface: stale ? null : { identity: this.config.identity, scope: this.config.scope,
          surface_name: 'work-status', kind: 'team-context', content } });
      state.seen.push(eventId); return eventId;
    });
  }
  async flush(call) {
    return locked(this.dir, 'delivery', async () => {
      const remote = call; const deadline = Date.now() + 20_000;
      call = (name, args) => {
        if (Date.now() >= deadline) throw Error('DELIVERY_BUDGET_EXHAUSTED');
        return remote(name, args);
      };
      const common = { identity: this.config.identity, scope: this.config.scope };
      let context = (await call('get_context', common)).context;
      if (!context) {
        await call('register_agent', { ...common, metadata: { person: this.config.person, client: this.config.client ?? 'claude-code-hooks', baseIdentity: this.config.baseIdentity } });
        context = (await call('get_context', common)).context;
      }
      const inbox = await call('receive_inbox', { ...common, limit: 5, lease_seconds: 30 });
      // A hook cannot carry out handoffs. Return leases instead of acknowledging work.
      for (const message of inbox.messages) await call('acknowledge', { ...common,
        message_id: message.messageId, lease_generation: message.leaseGeneration, success: false });
      let delivered = 0;
      for (const entry of this.read().pending) {
        await call('send_message', entry.message);
        if (entry.surface) {
          context = (await call('get_context', common)).context;
          const current = context?.surfaces.find(s => s.ownerIdentity === common.identity && s.surfaceName === 'work-status');
          const next = entry.surface.content;
          if (current && (current.content.instanceId !== next.instanceId || !Number.isSafeInteger(current.content.sequence))) {
            throw Error('SURFACE_WRITER_CONFLICT');
          }
          if (!current || current.content.sequence < next.sequence) await call('publish_surface', entry.surface);
          const confirmed = (await call('get_context', common)).context?.surfaces.find(s =>
            s.ownerIdentity === common.identity && s.surfaceName === 'work-status');
          if (!confirmed || !Number.isSafeInteger(confirmed.content.sequence) || confirmed.content.instanceId !== next.instanceId ||
              (confirmed.content.sequence <= next.sequence && JSON.stringify(confirmed.content) !== JSON.stringify(next))) {
            throw Error('SURFACE_READBACK_FAILED');
          }
        }
        await this.mutate(state => { state.pending = state.pending.filter(item => item.eventId !== entry.eventId); });
        delivered++;
      }
      return { delivered, pending: this.read().pending.length, inboxCount: inbox.messages.length, surfaceCount: context?.surfaces.length ?? 0 };
    }, 0);
  }
}
