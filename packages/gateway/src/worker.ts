import { sha256 } from '@context-plane/scenario';
import type { Harness } from './harness.js';
import type { InferenceProvider, InferenceResult } from './openrouter.js';
import { requireThat, safeKey } from './validation.js';

/** One bounded agent job. Restart with the same job key, task and budget to replay
 * saved turns and reconcile exact tool intents before asking for another turn.
 * A model's final response is a self-report, not task acceptance.
 */
export async function runAgent(options: {
  harness: Harness; token: string; jobKey: string; task: string;
  provider: InferenceProvider; maxTurns?: number;
}) {
  safeKey(options.jobKey);
  const maxTurns = options.maxTurns ?? 12;
  requireThat(Number.isSafeInteger(maxTurns) && maxTurns > 0 && maxTurns <= 24, 'INVALID_TURN_BUDGET');
  const turns: InferenceResult[] = [];
  for (let index = 0; index < maxTurns; index++) {
    const turnKey = `model-${sha256(`${options.jobKey}:${index}`).slice(7, 47)}`;
    const turn = await options.harness.modelTurn(options.token, turnKey, options.task, options.provider, options.jobKey);
    turns.push(turn);
    for (let callIndex = 0; callIndex < turn.toolCalls.length; callIndex++) {
      const call = turn.toolCalls[callIndex]!;
      const operationKey = `${turnKey}-tool-${callIndex}`;
      const args = call.name === 'apply_change' ? { ...call.arguments, operationKey } : call.arguments;
      await options.harness.executeModelTool(options.token, operationKey, call.name, args);
    }
    if (turn.toolCalls.length === 0) return { status: 'model_stopped' as const, turns };
  }
  return { status: 'budget_exhausted' as const, turns };
}
