import { MemoryStorage } from '../src/index.js';
import { conformance } from './conformance.js';

conformance('memory fixture (not Atlas evidence)', async () => {
  let now = Date.now();
  return { storage: new MemoryStorage(() => new Date(now)), expire: async () => { now += 300_001; } };
});
