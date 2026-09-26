import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
export function loadTeamEnvironment() {
  const values = parseEnv(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8'));
  if (!values.MONGODB_URI || !values.CONTEXT_PLANE_API_TOKEN || !values.MONGODB_DATABASE) throw new Error('TEAM_ENV_INCOMPLETE');
  return values;
}
