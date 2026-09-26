import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { MongoClient, type Db } from 'mongodb';
import { affectedFromEdges, impactOfChange, type ImpactEdge } from '../src/impact.js';

// provider -> a -> b -> c (3 hops), plus a cycle c -> a and a self-loop back to the provider.
const chain: ImpactEdge[] = [
  { dependencyId: 'd1', ownerIdentity: 'a', dependsOn: 'provider' },
  { dependencyId: 'd2', ownerIdentity: 'b', dependsOn: 'a' },
  { dependencyId: 'd3', ownerIdentity: 'c', dependsOn: 'b' },
  { dependencyId: 'd4', ownerIdentity: 'a', dependsOn: 'c' },
  { dependencyId: 'd5', ownerIdentity: 'provider', dependsOn: 'c' },
];

describe('affectedFromEdges', () => {
  it('returns depth and shortest path and terminates on cycles', () => {
    assert.deepEqual(affectedFromEdges('provider', chain), [
      { identity: 'a', depth: 1, path: ['provider', 'a'], dependencyIds: ['d1'] },
      { identity: 'b', depth: 2, path: ['provider', 'a', 'b'], dependencyIds: ['d1', 'd2'] },
      { identity: 'c', depth: 3, path: ['provider', 'a', 'b', 'c'], dependencyIds: ['d1', 'd2', 'd3'] },
    ]);
  });
  it('honours maxDepth', () => {
    assert.deepEqual(affectedFromEdges('provider', chain, 2).map(c => c.identity), ['a', 'b']);
  });
});

// Opt-in: a disposable local Mongo, e.g. CONTEXT_PLANE_IMPACT_MONGO_URI='mongodb://127.0.0.1:27027/?directConnection=true'; the test db is dropped
const uri = process.env.CONTEXT_PLANE_IMPACT_MONGO_URI;
describe('impactOfChange ($graphLookup)', { skip: uri ? false : 'CONTEXT_PLANE_IMPACT_MONGO_URI not set' }, () => {
  let client: MongoClient; let db: Db;
  const scope = { orgId: 'org_impact', projectId: 'project_impact', coordinationScope: 'scope_impact' };
  before(async () => {
    client = await new MongoClient(uri!, { serverSelectionTimeoutMS: 3000 }).connect();
    db = client.db(`cp_impact_test_${randomUUID().slice(0, 8)}`);
    await db.collection('cp_coordination_surfaces').insertOne({ ...scope, surfaceName: 'orders.quote', ownerIdentity: 'provider' });
    await db.collection('cp_coordination_dependencies').insertMany([
      ...chain.map(edge => ({ ...scope, ...edge })),
      // Same identities in another project and scope must never leak in.
      { ...scope, projectId: 'other_project', dependencyId: 'x1', ownerIdentity: 'intruder', dependsOn: 'provider' },
      { ...scope, coordinationScope: 'other_scope', dependencyId: 'x2', ownerIdentity: 'intruder2', dependsOn: 'c' },
    ]);
  });
  after(async () => { await db?.dropDatabase(); await client?.close(); });

  it('follows a 3-hop chain through the surface owner, scoped, with a cycle guard', async () => {
    const result = await impactOfChange(db, scope, 'orders.quote');
    assert.equal(result.provider, 'provider');
    assert.deepEqual(result.consumers.map(c => [c.identity, c.depth, c.path.join('>')]),
      [['a', 1, 'provider>a'], ['b', 2, 'provider>a>b'], ['c', 3, 'provider>a>b>c']]);
  });
  it('limits hops', async () => {
    const result = await impactOfChange(db, scope, 'provider', 1);
    assert.deepEqual(result.consumers.map(c => c.identity), ['a']);
  });
});
