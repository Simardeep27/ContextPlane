import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { digest } from './outbox.mjs';
const tools = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export function observation(input) {
  const kind = input.hook_event_name;
  if (!['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'].includes(kind)) return null;
  if (kind.startsWith('PostTool') && !tools.has(input.tool_name)) return null;
  if (typeof input.session_id !== 'string' || !input.session_id.length || input.session_id.length > 256) throw Error('INVALID_SESSION');
  let key = kind + ':' + (typeof input.prompt_id === 'string' ? digest(input.prompt_id) : randomUUID());
  if (kind.startsWith('PostTool')) {
    if (typeof input.tool_use_id !== 'string' || input.tool_use_id.length > 256 || !input.tool_use_id) throw Error('INVALID_TOOL_ID');
    key = kind + ':' + digest(input.tool_use_id);
  }
  if (kind === 'SessionStart') key = kind + ':' + (['startup', 'resume', 'clear', 'compact', 'fork'].includes(input.source) ? input.source : 'unknown');
  if (kind === 'SessionEnd') key = kind;
  const summary = kind === 'SessionStart' ? 'Claude Code session started or resumed; task outcome not verified'
    : kind === 'SessionEnd' ? 'Claude Code session ended; task outcome not verified'
    : kind === 'Stop' ? 'Claude Code turn stopped; task outcome not verified'
    : `Claude Code ${input.tool_name} ${kind === 'PostToolUseFailure' ? 'reported failure' : 'completed'}; result content not captured`;
  return { kind, key, summary };
}
const people = ['Shivraj', 'Simar', 'Buddhsen', 'Tanish'];
const identityPattern = /^[a-z][a-z0-9-]{0,31}:[a-z0-9:-]{1,60}$/;
// Commit authors in this repository's history; matched on git user.name/user.email.
const authors = [[/shivraj|bhatti/i, 'Shivraj'], [/simardeep/i, 'Simar'], [/buddhsen/i, 'Buddhsen'], [/tanish/i, 'Tanish']];
export const DEFAULT_TASK = 'https://github.com/Simardeep27/ContextPlane/issues/27';
const gitValue = (cwd, args) => { try {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
} catch { return ''; } };
export function personFrom(env, git) {
  if (env.CP_SYNC_PERSON) return env.CP_SYNC_PERSON;
  const who = `${git(['config', 'user.name'])} ${git(['config', 'user.email'])}`;
  return authors.find(([pattern]) => pattern.test(who))?.[1];
}
export function branchSlug(branch) {
  return (branch && branch !== 'HEAD' ? branch : 'detached').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'detached';
}
export function instanceFor(sessionId) {
  const h = createHash('sha256').update('cp-sync-instance:' + sessionId).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
// Settings-registered hooks run without the launcher: derive its environment.
// Returns null (skip reporting) when no token or no identifiable person exists.
export function hookEnvironment(env, input, repo, git = args => gitValue(repo, args)) {
  if (env.CP_SYNC_INSTANCE && env.CP_SYNC_IDENTITY) return env; // launcher-managed
  if (!env.CONTEXT_PLANE_API_TOKEN) return null;
  const person = personFrom(env, git);
  if (!person) return null;
  if (!people.includes(person)) throw Error('INVALID_PERSON');
  if (typeof input?.session_id !== 'string' || !input.session_id || input.session_id.length > 256) throw Error('INVALID_SESSION');
  return { ...env, CP_SYNC_PERSON: person, CP_SYNC_REPO: repo, CP_SYNC_TASK: env.CP_SYNC_TASK || DEFAULT_TASK,
    CP_SYNC_INSTANCE: instanceFor(input.session_id),
    CP_SYNC_IDENTITY: env.CP_SYNC_IDENTITY || `${person.toLowerCase()}:${branchSlug(git(['rev-parse', '--abbrev-ref', 'HEAD']))}` };
}
export function configuration(env, sessionId) {
  if (!identityPattern.test(env.CP_SYNC_IDENTITY ?? '')) throw Error('INVALID_IDENTITY');
  if (!/^[0-9a-f-]{36}$/.test(env.CP_SYNC_INSTANCE ?? '')) throw Error('INVALID_INSTANCE');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(env.CP_SYNC_TASK ?? '')) throw Error('INVALID_TASK_REFERENCE');
  const person = env.CP_SYNC_PERSON;
  if (!people.includes(person)) throw Error('INVALID_PERSON');
  const recipient = env.CP_SYNC_RECIPIENT || `${person.toLowerCase()}:primary`;
  if (!identityPattern.test(recipient)) throw Error('INVALID_RECIPIENT');
  const session = digest(sessionId).slice(0, 24);
  return { baseIdentity: env.CP_SYNC_IDENTITY,
    identity: `${env.CP_SYNC_IDENTITY}:hook-${digest(env.CP_SYNC_INSTANCE + session).slice(0, 16)}`,
    person, instanceId: env.CP_SYNC_INSTANCE, sessionId: session, task: env.CP_SYNC_TASK,
    scope: 'project:context-plane', recipient };
}
