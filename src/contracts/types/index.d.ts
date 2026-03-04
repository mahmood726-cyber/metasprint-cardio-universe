export interface SourceIdsV1 {
  nctId?: string;
  pmid?: string;
  doi?: string;
}

export interface InterventionV1 {
  rawName: string;
  normalizedName: string;
  classId: string;
  isComparator: boolean;
}

export interface OutcomeV1 {
  rawText: string;
  normalizedOutcomeId: string;
  domain: 'mortality' | 'mace' | 'hf' | 'arrhythmia' | 'renal' | 'safety' | 'other';
  timepoint?: string;
}

export interface TrialRecordV1 {
  schemaVersion: 'trial_record.v1';
  trialId: string;
  source: 'ctgov' | 'aact' | 'pubmed' | 'openalex' | 'europepmc' | 'manual';
  sourceIds: SourceIdsV1;
  title: string;
  status?: string;
  phase?: 'phase_1' | 'phase_2' | 'phase_3' | 'phase_4' | 'mixed' | 'unknown';
  enrollment: number;
  randomized: boolean;
  interventions: InterventionV1[];
  conditions?: string[];
  primaryOutcomes: OutcomeV1[];
  subcategoryId: string;
  quality?: {
    completenessScore?: number;
    confidenceClass?: 'high' | 'moderate' | 'low' | 'very_low';
  };
  provenanceRef?: string;
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface ClusterV1 {
  schemaVersion: 'cluster.v1';
  clusterId: string;
  subcategoryId: string;
  outcomeId: string;
  effectMeasure: 'HR' | 'OR' | 'RR' | 'RD' | 'MD' | 'SMD';
  trialIds: string[];
  sourceCoverage?: Record<string, number>;
  scoreBreakdown: {
    evidenceGap: number;
    freshness: number;
    feasibility: number;
    uncertaintyPenalty: number;
    guidelineRelevance: number;
    total: number;
  };
  confidenceClass?: 'high' | 'moderate' | 'low' | 'very_low';
  provenanceRef: string;
  refresh: {
    refreshedAt: string;
    snapshotId: string;
  };
}

export interface ProvenanceV1 {
  schemaVersion: 'provenance.v1';
  provenanceId: string;
  generatedAt: string;
  pipelineVersion: string;
  sourceSnapshots: Array<{
    source: 'ctgov' | 'aact' | 'pubmed' | 'openalex' | 'europepmc' | 'manual';
    extractedAt: string;
    endpoint: string;
    queryHash: string;
    recordCount: number;
  }>;
  transformations: Array<{
    step: string;
    version: string;
    inputHash: string;
    outputHash: string;
    executedAt: string;
    params?: Record<string, unknown>;
  }>;
  metricDerivations: Array<{
    metricId: string;
    formula: string;
    inputs: string[];
    output: string;
  }>;
  auditTrail?: Array<{
    at: string;
    actor: string;
    action: string;
    details?: string;
  }>;
  missingEvidenceRisk?: {
    framework: 'ROB-ME';
    overallJudgement: 'low' | 'some_concerns' | 'high';
    assessedAt: string;
    evidencePath?: string;
    scenarioCoverage?: number;
    domains?: {
      biasDueToMissingResultsInPublishedStudies?: 'low' | 'some_concerns' | 'high';
      biasDueToSelectivePublication?: 'low' | 'some_concerns' | 'high';
    };
    signals?: Record<string, unknown>;
    rationale?: string;
  };
  networkMissingEvidenceRisk?: {
    framework: 'RoB NMA';
    overallJudgement: 'low' | 'some_concerns' | 'high';
    assessedAt: string;
    evidencePath?: string;
    networkCount?: number;
    domains?: Record<string, unknown>;
    signals?: Record<string, unknown>;
    rationale?: string;
  };
}

export interface GraphEntityV1 {
  schemaVersion: 'graph_entity.v1';
  entityId: string;
  entityType: 'trial' | 'publication' | 'intervention' | 'endpoint' | 'subgroup' | 'guideline_topic';
  label: string;
  canonicalCode?: string;
  sourceRefs: string[];
  attributes?: Record<string, unknown>;
  provenanceRef?: string;
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface GraphEdgeV1 {
  schemaVersion: 'graph_edge.v1';
  edgeId: string;
  fromEntityId: string;
  toEntityId: string;
  relationType:
    | 'reports'
    | 'evaluates'
    | 'targets'
    | 'measures'
    | 'belongs_to'
    | 'maps_to'
    | 'supports'
    | 'contradicts';
  weight?: number;
  directed?: boolean;
  evidenceRefs: string[];
  confidenceClass: 'high' | 'moderate' | 'low' | 'very_low';
  provenanceRef: string;
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface GraphDatasetV1 {
  schemaVersion: 'graph_dataset.v1';
  datasetId: string;
  generatedAt: string;
  snapshotId: string;
  pipelineVersion?: string;
  entities: GraphEntityV1[];
  edges: GraphEdgeV1[];
  metadata?: Record<string, unknown>;
}
