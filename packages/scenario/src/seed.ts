import type { PersistenceAdapter } from '@context-plane/contracts';
import type { ResettableStorage } from '@context-plane/persistence';
import * as fixture from './fixture.js';

/**
 * Clears the scenario project and writes its initial state: dependency head
 * N, Dev A's candidate at N, the two seed events, and projection revision 1.
 * Only the fixed scenario scope is ever deleted.
 */
export async function resetAndSeed(storage: ResettableStorage, adapter: PersistenceAdapter) {
  await storage.deleteScope(fixture.scope);
  for (const event of fixture.seededEvents) await adapter.appendEvent(event);
  await adapter.saveRecord({ record: fixture.seededDependency, expectedRevision: 0 });
  await adapter.saveRecord({ record: fixture.seededCandidate, expectedRevision: 0 });
  await adapter.saveProjection(fixture.seededProjection, 0);
  return manifest();
}

/** Stable, credential-free summary of what the scenario seeds and expects. */
export function manifest() {
  return {
    scope: fixture.scope,
    identities: fixture.identities,
    dependencyEdge: fixture.dependencyEdge,
    revisions: { n: fixture.revisionN, next: fixture.revisionNext },
    artifacts: Object.fromEntries(Object.entries(fixture.artifacts).map(([name, a]) => [name, { path: a.path, artifactHash: a.artifactHash }])),
    candidates: {
      stale: { candidateHash: fixture.candidates.stale.candidateHash, dependencyRevision: fixture.candidates.stale.dependencyRevision },
      combined: { candidateHash: fixture.candidates.combined.candidateHash, dependencyRevision: fixture.candidates.combined.dependencyRevision },
    },
    devBPublication: { commandId: fixture.devBPublication.commandId, idempotencyKey: fixture.devBPublication.idempotencyKey },
    policy: { initialEpoch: fixture.initialPolicyEpoch, datasetHash: fixture.policyDatasetHash,
      cases: fixture.policyDataset.map(c => `${c.caseId} (${c.kind} -> ${c.expected})`) },
    seeded: { events: fixture.seededEvents.map(e => `${e.cursor} ${e.type}`), projectionRevision: fixture.seededProjection.revision },
  };
}
