import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceRecord } from '../shared/evidence.ts';
const directory = process.argv[2]; const destination = process.argv[3];
if (!directory || !destination) throw new Error('Pass a verified E2E directory and output JSON path.');
const manifest = JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
if (manifest.sourceDirty || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || manifest.mode !== 'file') throw new Error('Require clean-commit isolated verification evidence.');
const rows: [string, { value: unknown }][] = JSON.parse(await readFile(join(directory,'storage.json'),'utf8'));
const records = rows.filter(([key]) => { const [org,project,kind] = JSON.parse(key); return org === manifest.scope.orgId && project === manifest.scope.projectId && kind === 'events'; })
  .map(([,row]) => evidenceRecord(row.value)).filter(r => r !== null).sort((a,b) => Number(a.cursor)-Number(b.cursor));
if (!records.some(r => r.action === 'policy_activated')) throw new Error('Missing policy lifecycle evidence.');
const artifact = { sourceCommit: manifest.sourceCommit, observedAt: manifest.observedAt, projectId: manifest.scope.projectId,
  modelCalls: manifest.modelCalls, records };
await writeFile(destination, JSON.stringify(artifact,null,2)+'\n');
console.log(`Exported ${records.length} allowlisted records.`);
