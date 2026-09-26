import { DurablePersistenceAdapter, MemoryStorage, connectStorage } from '@context-plane/persistence';
import { resetAndSeed } from './seed.js';

// Resets and seeds the Dev A / Dev B scenario. Uses Atlas when MONGODB_URI is
// set (database MONGODB_DATABASE, default context_plane_poc); otherwise an
// in-memory store, which only validates the seed and is discarded on exit.
const database = process.env.MONGODB_DATABASE ?? 'context_plane_poc';

if (process.env.MONGODB_URI) {
  const connection = await connectStorage(database);
  try {
    await connection.storage.initialize();
    const result = await resetAndSeed(connection.storage, new DurablePersistenceAdapter(connection.storage));
    console.log(JSON.stringify({ target: `atlas:${database}`, ...result }, null, 2));
  } finally {
    await connection.close();
  }
} else {
  const storage = new MemoryStorage();
  const result = await resetAndSeed(storage, new DurablePersistenceAdapter(storage));
  console.log(JSON.stringify({ target: 'memory (MONGODB_URI not set; nothing persisted)', ...result }, null, 2));
}
