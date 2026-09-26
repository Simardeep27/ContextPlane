#!/usr/bin/env node
// Load the guiding principles from docs/COMPANY_BRAIN.md through the MCP
// `remember` tool. Run by a human with their own *:primary identity (or
// human:*). Idempotent: stable entry IDs per principle; reruns are no-ops.
//
// Usage: CONTEXT_PLANE_PRINCIPLE_IDENTITY=shivraj:primary \
//   node scripts/brain/seed-principles.mjs [--dry-run]
// Env: CONTEXT_PLANE_API_TOKEN (never printed), optional CONTEXT_PLANE_MCP_URL,
//      optional CONTEXT_PLANE_COORDINATION_SCOPE (default project:context-plane).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOC = fileURLToPath(new URL('../../docs/COMPANY_BRAIN.md', import.meta.url));
const LINE = /^\d+\. \*\*(.+?)\*\* (.+?) _Source: (.+)_$/;
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function parsePrinciples(markdown) {
  const section = markdown.split(/^## Guiding principles$/m)[1]?.split(/^## /m)[0] ?? '';
  return section.split('\n').map(line => LINE.exec(line.trim())).filter(Boolean).map(([, title, body, source]) => ({
    entryId: `principle:${slug(title)}`, title: title.replace(/\.$/, ''), body, sourceIds: [source.trim()],
  }));
}

/** Requires an existing registration: seeding never registers or re-registers a person's identity. */
export async function seed(mcp, identity, scope, principles) {
  if (!(await mcp.call('get_context', { identity, scope })).context) throw new Error('AGENT_NOT_REGISTERED');
  const stored = [];
  for (const principle of principles) {
    stored.push(await mcp.call('remember', { identity, scope, kind: 'principle', title: principle.title,
      body: principle.body, source_ids: principle.sourceIds, entry_id: principle.entryId }));
  }
  return stored;
}

async function main(argv) {
  const principles = parsePrinciples(readFileSync(DOC, 'utf8'));
  if (principles.length < 5) throw new Error('PRINCIPLES_NOT_FOUND');
  if (argv.includes('--dry-run')) { console.log(JSON.stringify(principles, null, 2)); return; }
  const identity = process.env.CONTEXT_PLANE_PRINCIPLE_IDENTITY;
  if (!identity || !/^(human:[^\s]+|[^\s:]+:primary)$/.test(identity)) throw new Error('PRINCIPLE_IDENTITY_REQUIRED');
  const scope = process.env.CONTEXT_PLANE_COORDINATION_SCOPE ?? 'project:context-plane';
  const { connect } = await import('../agent-sync/transport.mjs');
  const mcp = await connect();
  try {
    for (const entry of await seed(mcp, identity, scope, principles)) {
      console.log(JSON.stringify({ event: 'principle_remembered', entryId: entry.entryId, createdAt: entry.createdAt }));
    }
  } finally { await mcp.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SEED_FAILED');
    process.exitCode = 1;
  });
}
