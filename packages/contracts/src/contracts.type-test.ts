import type {
  Brand,
  CandidateHash,
  ChangeCheckVersion,
  CommitStep,
  LeaseToken,
  OrgId,
  PersistenceAdapter,
  ProjectScope,
  RunCheckpoint,
} from "./index.js";

type TestOrg = Brand<"org-test", "OrgId"> & OrgId;
type ProjectA = Brand<"project-a", "ProjectId">;
type ProjectB = Brand<"project-b", "ProjectId">;
type ScopeA = ProjectScope<TestOrg, ProjectA>;
type ScopeB = ProjectScope<TestOrg, ProjectB>;

declare const persistence: PersistenceAdapter;
declare const checkpointA: RunCheckpoint<ChangeCheckVersion, ScopeA>;
declare const leaseA: LeaseToken<ScopeA>;
declare const leaseB: LeaseToken<ScopeB>;

void persistence.saveCheckpoint(checkpointA, leaseA);
// @ts-expect-error a lease capability for another project cannot fence this write
void persistence.saveCheckpoint(checkpointA, leaseB);

type CandidateA = Brand<"candidate-a", "CandidateHash"> & CandidateHash;
type VersionAtOne = ChangeCheckVersion<CandidateA, 1, 1>;
type VersionAtTwo = ChangeCheckVersion<CandidateA, 2, 1>;

declare const versionAtOne: VersionAtOne;
declare const checkpointAtOne: RunCheckpoint<VersionAtOne, ScopeA>;
declare const checkpointAtTwo: RunCheckpoint<VersionAtTwo, ScopeA>;

const currentStep: CommitStep<VersionAtOne, ScopeA> = {
  candidateVersion: versionAtOne,
  checkpoint: checkpointAtOne,
  lease: leaseA,
};
void currentStep;

const staleTupleStep: CommitStep<VersionAtOne, ScopeA> = {
  candidateVersion: versionAtOne,
  // @ts-expect-error a checkpoint at dependency revision 2 cannot join revision 1
  checkpoint: checkpointAtTwo,
  lease: leaseA,
};
void staleTupleStep;
