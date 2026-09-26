import { MemoryStorage } from '../src/index.js';
import { conformance, type Harness } from './conformance.js';
import { recordConformance } from './records-conformance.js';

const memory = async (): Promise<Harness> => {
  let now = Date.now();
  return { storage: new MemoryStorage(() => new Date(now)), expire: async () => { now += 300_001; } };
};
conformance('memory fixture (not Atlas evidence)', memory);
recordConformance('memory records fixture (not Atlas evidence)', memory);
