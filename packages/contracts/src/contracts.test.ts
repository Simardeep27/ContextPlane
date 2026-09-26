import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedResumedCompletedEvents,
  blockedResumedCompletedProjections,
  completedCheckpoint,
  protectedReadReceipt,
} from "./fixtures/access-run.js";
import type { LeaseToken } from "./adapters.js";
import type { CandidateHash, ChangeCheckVersion, ProjectScope, RunId } from "./contracts.js";
import { immutableRecordKinds, recordKinds, staleVersionReasons } from "./records.js";
import { roleToolAllowlists, toolDefinitions, toolNames } from "./tools.js";

test("fixture preserves scope and monotonic event ordering", () => {
  const [first] = blockedResumedCompletedEvents;
  assert.ok(first);

  for (const [index, event] of blockedResumedCompletedEvents.entries()) {
    assert.deepEqual(event.scope, first.scope);
    assert.equal(event.revision, index + 1);
    assert.equal(event.cursor, String(index + 1).padStart(6, "0"));
  }
});

test("fixture projects blocked, resumed, and completed states", () => {
  assert.deepEqual(
    blockedResumedCompletedProjections.map((projection) => projection.runs[0]?.status),
    ["blocked", "running", "completed"],
  );
  assert.equal(blockedResumedCompletedProjections[0]?.accessRequests[0]?.status, "pending");
  assert.equal(blockedResumedCompletedProjections[1]?.accessRequests[0]?.status, "approved");
  assert.equal(blockedResumedCompletedProjections[2]?.timeline.length, 4);
});

test("completed side effect is reconciled by one stable operation key", () => {
  assert.equal(completedCheckpoint.completedOperationKeys.length, 1);
  assert.equal(completedCheckpoint.completedOperationKeys[0], protectedReadReceipt.operationKey);
  assert.equal(protectedReadReceipt.attempt, 1);
  assert.equal(protectedReadReceipt.status, "succeeded");
});

test("roles have distinct tool allowlists and cannot self-approve", () => {
  assert.notDeepEqual(roleToolAllowlists.pm, roleToolAllowlists.orders);
  assert.notDeepEqual(roleToolAllowlists.orders, roleToolAllowlists.billing);

  for (const tools of Object.values(roleToolAllowlists)) {
    assert.equal(tools.includes("approve_access" as never), false);
    assert.equal(tools.includes("promote_rule" as never), false);
  }
});

test("every public tool name has one strict input schema", () => {
  assert.deepEqual(Object.keys(toolDefinitions), [...toolNames]);

  for (const definition of Object.values(toolDefinitions)) {
    assert.equal(definition.inputSchema.additionalProperties, false);
    assert.equal(definition.inputSchema.type, "object");
  }
});

test("lease tokens are project-scoped at the type level", () => {
  const scope = { orgId: "org", projectId: "project" } as ProjectScope;
  const scoped: LeaseToken = { scope, runId: "run" as RunId, generation: 1, expiresAt: "2026-09-26T14:00:00.000Z" };
  // @ts-expect-error A lease without its project scope is not a LeaseToken.
  const unscoped: LeaseToken = { runId: "run" as RunId, generation: 1, expiresAt: "2026-09-26T14:00:00.000Z" };
  assert.ok(scoped.scope);
  assert.equal("scope" in unscoped, false);
});

test("stale, future, and mismatched version tuples are named", () => {
  const hash = "sha256:candidate" as CandidateHash;
  const current = { candidateHash: hash, dependencyRevision: 8, policyEpoch: 2 };
  const at = (dependencyRevision: number, policyEpoch: number, candidateHash = hash): ChangeCheckVersion =>
    ({ candidateHash, dependencyRevision, policyEpoch });

  assert.deepEqual(staleVersionReasons(at(8, 2), current), []);
  assert.deepEqual(staleVersionReasons(at(7, 2), current), ["STALE_DEPENDENCY_REVISION"]);
  assert.deepEqual(staleVersionReasons(at(8, 1), current), ["STALE_POLICY_EPOCH"]);
  assert.deepEqual(staleVersionReasons(at(9, 3), current), ["FUTURE_DEPENDENCY_REVISION", "FUTURE_POLICY_EPOCH"]);
  assert.deepEqual(
    staleVersionReasons(at(7, 2, "sha256:other" as CandidateHash), current),
    ["CANDIDATE_HASH_MISMATCH", "STALE_DEPENDENCY_REVISION"],
  );
});

test("immutable record kinds are a subset of record kinds", () => {
  for (const kind of immutableRecordKinds) assert.ok(recordKinds.includes(kind));
});
