#!/usr/bin/env node
// Creates the Atlas Vector Search index used by the MCP `check_overlap` tool (issue #53).
// Run by a human/operator against Atlas; agents and tests never run it against team Atlas.
//
//   node scripts/atlas/create-vector-index.mjs --dry-run           # print the definition only
//   MONGODB_URI=... MONGODB_DATABASE=context_plane node scripts/atlas/create-vector-index.mjs
//
// The URI is read from the environment (inject it from Keychain); it is never printed.
import { pathToFileURL } from 'node:url';

export const COLLECTION = 'cp_work_embeddings';
export const INDEX_NAME = 'cp_work_embeddings_vector';
export const indexDefinition = {
  name: INDEX_NAME,
  type: 'vectorSearch',
  definition: {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: 1024, similarity: 'cosine' },
      { type: 'filter', path: 'orgId' },
      { type: 'filter', path: 'projectId' },
      { type: 'filter', path: 'scope' },
    ],
  },
};

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const database = process.env.MONGODB_DATABASE || 'context_plane';
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, database, collection: COLLECTION, index: indexDefinition }, null, 2));
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required (inject it from Keychain; do not pass it as an argument).');
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  try {
    const db = client.db(database);
    if (!(await db.listCollections({ name: COLLECTION }).hasNext())) await db.createCollection(COLLECTION);
    const collection = db.collection(COLLECTION);
    const existing = (await collection.listSearchIndexes(INDEX_NAME).toArray())[0];
    if (existing) {
      console.log(JSON.stringify({ event: 'index_exists', database, collection: COLLECTION, index: INDEX_NAME,
        status: existing.status ?? null, queryable: existing.queryable ?? null }));
      return;
    }
    await collection.createSearchIndex(indexDefinition);
    console.log(JSON.stringify({ event: 'index_requested', database, collection: COLLECTION, index: INDEX_NAME,
      note: 'Atlas builds the index asynchronously; check_overlap uses the lexical fallback until it is queryable.' }));
  } finally {
    await client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'INDEX_CREATION_FAILED'); process.exitCode = 1; });
}
