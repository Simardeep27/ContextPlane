import { randomUUID } from 'node:crypto';
import { configuration as baseConfiguration } from './claude.mjs';
import { digest } from './outbox.mjs';
export function configuration(env, sessionId) {
  return { ...baseConfiguration(env, sessionId), client: 'codex-hooks' };
}
export function observation(input) {
  const kind = input.hook_event_name;
  if (!['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse'].includes(kind)) return null;
  if (kind === 'PostToolUse' && !['Bash', 'apply_patch'].includes(input.tool_name)) return null;
  if (typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 256) throw Error('INVALID_SESSION');
  let key = kind;
  if (kind === 'SessionStart') key += ':' + (['startup', 'resume', 'clear', 'compact'].includes(input.source) ? input.source : 'unknown');
  if (kind === 'Stop') key += ':' + (typeof input.turn_id === 'string' ? digest(input.turn_id) : randomUUID());
  if (kind === 'PostToolUse') {
    if (typeof input.tool_use_id !== 'string' || !input.tool_use_id || input.tool_use_id.length > 256) throw Error('INVALID_TOOL_ID');
    key += ':' + digest(input.tool_use_id);
    // Codex emits PostToolUse for both successful and failed Bash calls. Only
    // classify a structured exit code; opaque tool output remains unclassified.
    const code = input.tool_response?.exit_code;
    const failed = input.tool_name === 'Bash' && Number.isSafeInteger(code) && code !== 0;
    return { kind: failed ? 'PostToolUseFailure' : kind, key,
      summary: `Codex ${input.tool_name} ${failed ? 'reported nonzero exit' : 'returned; success or failure not verified'}; result content not captured` };
  }
  return { kind, key, summary: `Codex ${kind === 'SessionStart' ? 'session started or resumed' : kind === 'Stop' ? 'turn stopped' : 'session ended'}; task outcome not verified` };
}
