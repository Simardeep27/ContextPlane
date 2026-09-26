import { randomUUID } from 'node:crypto';
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
export function configuration(env, sessionId) {
  if (!/^[a-z][a-z0-9-]{0,31}:[a-z0-9:-]{1,60}$/.test(env.CP_SYNC_IDENTITY ?? '')) throw Error('INVALID_IDENTITY');
  if (!/^[0-9a-f-]{36}$/.test(env.CP_SYNC_INSTANCE ?? '')) throw Error('INVALID_INSTANCE');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(env.CP_SYNC_TASK ?? '')) throw Error('INVALID_TASK_REFERENCE');
  const person = env.CP_SYNC_PERSON;
  if (!['Shivraj', 'Simar', 'Buddhsen', 'Tanish'].includes(person)) throw Error('INVALID_PERSON');
  const session = digest(sessionId).slice(0, 24);
  return { baseIdentity: env.CP_SYNC_IDENTITY,
    identity: `${env.CP_SYNC_IDENTITY}:hook-${digest(env.CP_SYNC_INSTANCE + session).slice(0, 16)}`,
    person, instanceId: env.CP_SYNC_INSTANCE, sessionId: session, task: env.CP_SYNC_TASK,
    scope: 'project:context-plane', recipient: 'shivraj:primary' };
}
