import type {
  AgentId,
  ArtifactHash,
  CandidateHash,
  DependencyId,
  DependencyRevision,
  EvidenceId,
  EvidenceReference,
  OrgId,
  ProjectId,
  ProjectScope,
  UserId,
} from "@context-plane/contracts";

import { artifactHash, candidateHash, canonicalJson, sha256 } from "./hash.js";

export type ServiceId = "orders" | "billing";
export type ScenarioSnapshotId = "baseline" | "dev-b-published" | "stale-candidate" | "combined-candidate";

export interface SyntheticDeveloper {
  readonly userId: UserId;
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly serviceId: ServiceId;
}

export interface SyntheticService {
  readonly serviceId: ServiceId;
  readonly ownerAgentId: AgentId;
  readonly path: string;
}

export interface DependencyEdge {
  readonly dependencyId: DependencyId;
  readonly providerServiceId: ServiceId;
  readonly consumerServiceId: ServiceId;
  readonly contract: "monetary-unit";
  readonly unit: "cents";
  readonly revision: number;
}

export interface ArtifactFile {
  readonly path: string;
  readonly content: string;
  readonly artifactHash: ArtifactHash;
}

export interface CandidateFixture {
  readonly candidateHash: CandidateHash;
  readonly dependencyRevision: number;
  readonly policyEpoch: number;
  readonly changeKind: "unit_change";
  readonly expectedOutcome: "consumer-contract-failure" | "pass";
  readonly summary: string;
  readonly artifacts: readonly ArtifactFile[];
}

export interface PolicyAcknowledgement {
  readonly agentId: AgentId;
  readonly dependencyRevision: number;
  readonly outcome: "patched" | "no-change";
}

export interface PolicyEvaluationCase {
  readonly caseId: string;
  readonly changeKind: "unit_change" | "field_addition" | "unrelated_failure";
  readonly dependencyRevision: number;
  readonly candidateDependencyRevision: number;
  readonly requiredAgentIds: readonly AgentId[];
  readonly acknowledgements: readonly PolicyAcknowledgement[];
  readonly observedFailure: "consumer-contract" | "unrelated-test" | null;
  readonly expectedDecision: "block" | "allow" | "ignore";
  readonly eligibleForLearning: boolean;
}

export interface ScenarioManifest {
  readonly schemaVersion: 1;
  readonly scenarioId: "mvp-02-dev-a-dev-b";
  readonly scope: ProjectScope;
  readonly policyEpoch: 1;
  readonly seededAt: string;
  readonly developers: readonly SyntheticDeveloper[];
  readonly services: readonly SyntheticService[];
  readonly dependency: DependencyEdge;
  readonly dependencyRevisions: readonly DependencyRevision[];
  readonly devBPublication: {
    readonly dependencyRevision: number;
    readonly artifact: ArtifactFile;
    readonly evidence: EvidenceReference;
  };
  readonly staleCandidate: CandidateFixture;
  readonly combinedCandidate: CandidateFixture;
  readonly snapshots: Readonly<Record<ScenarioSnapshotId, readonly ArtifactFile[]>>;
  readonly policyDatasetHash: string;
  readonly policyCases: readonly PolicyEvaluationCase[];
}

const scope = {
  orgId: "org_synthetic_demo" as OrgId,
  projectId: "project_mvp_02" as ProjectId,
} as const;

const devAAgentId = "agent_dev_a_orders" as AgentId;
const devBAgentId = "agent_dev_b_billing" as AgentId;
const dependencyId = "dependency_orders_billing" as DependencyId;

const ordersCents = `export interface Quote {
  readonly totalCents: number;
}

export function quoteTotal(unitPriceCents: number, quantity: number): Quote {
  return { totalCents: unitPriceCents * quantity };
}
`;

const ordersDollars = `export interface Quote {
  readonly totalDollars: number;
}

export function quoteTotal(unitPriceCents: number, quantity: number): Quote {
  return { totalDollars: (unitPriceCents * quantity) / 100 };
}
`;

const billingBaseline = `export interface OrdersQuote {
  readonly totalCents: number;
}

export function invoiceTotalDollars(quote: OrdersQuote): number {
  return quote.totalCents / 100;
}
`;

const billingPublished = `export interface OrdersQuote {
  readonly totalCents: number;
}

export function invoiceTotalDollars(quote: OrdersQuote): number {
  return Math.round(quote.totalCents) / 100;
}
`;

const billingCoordinated = `export interface OrdersQuote {
  readonly totalDollars: number;
}

export function invoiceTotalDollars(quote: OrdersQuote): number {
  return quote.totalDollars;
}
`;

function artifact(path: string, content: string): ArtifactFile {
  return { path, content, artifactHash: artifactHash(content) };
}

const ordersBaselineArtifact = artifact("services/orders/src/quote.ts", ordersCents);
const ordersDollarsArtifact = artifact("services/orders/src/quote.ts", ordersDollars);
const billingBaselineArtifact = artifact("services/billing/src/invoice.ts", billingBaseline);
const billingPublishedArtifact = artifact("services/billing/src/invoice.ts", billingPublished);
const billingCoordinatedArtifact = artifact("services/billing/src/invoice.ts", billingCoordinated);

function defineCandidate(
  dependencyRevision: number,
  expectedOutcome: CandidateFixture["expectedOutcome"],
  summary: string,
  artifacts: readonly ArtifactFile[],
): CandidateFixture {
  const versionInput = {
    dependencyRevision,
    policyEpoch: 1,
    changeKind: "unit_change",
    artifacts: artifacts.map(({ path, artifactHash: hash }) => ({ path, artifactHash: hash })),
  } as const;
  return {
    candidateHash: candidateHash(versionInput),
    dependencyRevision,
    policyEpoch: 1,
    changeKind: "unit_change",
    expectedOutcome,
    summary,
    artifacts,
  };
}

const publicationEvidence: EvidenceReference = {
  evidenceId: "evidence_dev_b_publication_n_plus_1" as EvidenceId,
  kind: "synthetic-publication",
  contentHash: sha256(canonicalJson({
    dependencyId,
    revision: 8,
    artifactHash: billingPublishedArtifact.artifactHash,
  })),
};

const policyCases = [
  {
    caseId: "unsafe-missing-consumer-ack",
    changeKind: "unit_change",
    dependencyRevision: 8,
    candidateDependencyRevision: 8,
    requiredAgentIds: [devBAgentId],
    acknowledgements: [],
    observedFailure: "consumer-contract",
    expectedDecision: "block",
    eligibleForLearning: true,
  },
  {
    caseId: "unsafe-stale-consumer-ack",
    changeKind: "unit_change",
    dependencyRevision: 8,
    candidateDependencyRevision: 8,
    requiredAgentIds: [devBAgentId],
    acknowledgements: [{ agentId: devBAgentId, dependencyRevision: 7, outcome: "no-change" }],
    observedFailure: "consumer-contract",
    expectedDecision: "block",
    eligibleForLearning: true,
  },
  {
    caseId: "valid-coordinated-unit-change",
    changeKind: "unit_change",
    dependencyRevision: 8,
    candidateDependencyRevision: 8,
    requiredAgentIds: [devBAgentId],
    acknowledgements: [{ agentId: devBAgentId, dependencyRevision: 8, outcome: "patched" }],
    observedFailure: null,
    expectedDecision: "allow",
    eligibleForLearning: true,
  },
  {
    caseId: "safe-unrelated-field-addition",
    changeKind: "field_addition",
    dependencyRevision: 8,
    candidateDependencyRevision: 8,
    requiredAgentIds: [],
    acknowledgements: [],
    observedFailure: null,
    expectedDecision: "allow",
    eligibleForLearning: true,
  },
  {
    caseId: "unrelated-test-failure",
    changeKind: "unrelated_failure",
    dependencyRevision: 8,
    candidateDependencyRevision: 8,
    requiredAgentIds: [],
    acknowledgements: [],
    observedFailure: "unrelated-test",
    expectedDecision: "ignore",
    eligibleForLearning: false,
  },
] as const satisfies readonly PolicyEvaluationCase[];

const staleCandidate = defineCandidate(
  7,
  "consumer-contract-failure",
  "Dev A changes the Orders monetary unit while still based on dependency revision N.",
  [ordersDollarsArtifact],
);

const combinedCandidate = defineCandidate(
  8,
  "pass",
  "Orders changes to dollars and Billing consumes the exact coordinated contract at N+1.",
  [ordersDollarsArtifact, billingCoordinatedArtifact],
);

export const mvp02Scenario = {
  schemaVersion: 1,
  scenarioId: "mvp-02-dev-a-dev-b",
  scope,
  policyEpoch: 1,
  seededAt: "2026-09-26T15:00:00.000Z",
  developers: [
    {
      userId: "user_dev_a" as UserId,
      agentId: devAAgentId,
      displayName: "Dev A",
      serviceId: "orders",
    },
    {
      userId: "user_dev_b" as UserId,
      agentId: devBAgentId,
      displayName: "Dev B",
      serviceId: "billing",
    },
  ],
  services: [
    { serviceId: "orders", ownerAgentId: devAAgentId, path: "services/orders" },
    { serviceId: "billing", ownerAgentId: devBAgentId, path: "services/billing" },
  ],
  dependency: {
    dependencyId,
    providerServiceId: "orders",
    consumerServiceId: "billing",
    contract: "monetary-unit",
    unit: "cents",
    revision: 7,
  },
  dependencyRevisions: [
    {
      scope,
      dependencyId,
      revision: 7,
      artifactHash: billingBaselineArtifact.artifactHash,
      evidence: [],
      publishedAt: "2026-09-26T14:55:00.000Z",
    },
    {
      scope,
      dependencyId,
      revision: 8,
      artifactHash: billingPublishedArtifact.artifactHash,
      evidence: [publicationEvidence],
      publishedAt: "2026-09-26T15:00:00.000Z",
    },
  ],
  devBPublication: {
    dependencyRevision: 8,
    artifact: billingPublishedArtifact,
    evidence: publicationEvidence,
  },
  staleCandidate,
  combinedCandidate,
  snapshots: {
    baseline: [ordersBaselineArtifact, billingBaselineArtifact],
    "dev-b-published": [ordersBaselineArtifact, billingPublishedArtifact],
    "stale-candidate": [ordersDollarsArtifact, billingPublishedArtifact],
    "combined-candidate": [ordersDollarsArtifact, billingCoordinatedArtifact],
  },
  policyDatasetHash: sha256(canonicalJson(policyCases)),
  policyCases,
} as const satisfies ScenarioManifest;
