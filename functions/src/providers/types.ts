// Cloud provider plugin interfaces and shared data models for the optimization engine.
// All collectors, recommenders, and remediators implement these interfaces regardless of cloud.

/** Supported cloud providers */
export type CloudProvider = 'Azure' | 'AWS' | 'GCP';

/** Supported cloud environments within Azure */
export type AzureEnvironment = 'AzureCloud' | 'AzureChinaCloud' | 'AzureUSGovernment';

/** Recommendation impact levels */
export type RecommendationImpact = 'High' | 'Medium' | 'Low';

/** Recommendation categories aligned with FinOps capabilities */
export type RecommendationCategory = 'Cost' | 'HighAvailability' | 'Performance' | 'Security' | 'Governance' | 'OperationalExcellence';

/** Suppression filter types */
export type FilterType = 'Dismiss' | 'Snooze' | 'Exclude';

// ---------------------------------------------------------------------------
// Data models — normalized across clouds
// ---------------------------------------------------------------------------

/** Base record that every collected resource row includes */
export interface CollectedRecord {
  /** ISO-8601 timestamp of when this record was collected */
  timestamp: string;
  /** Cloud provider that owns this resource */
  cloud: CloudProvider;
  /** Tenant/account/organization identifier */
  tenantId: string;
  /** Subscription/account/project identifier */
  subscriptionId: string;
  /** Resource group, AWS region-account, or GCP project */
  resourceGroup: string;
  /** Fully qualified resource ID */
  instanceId: string;
  /** Short display name */
  instanceName: string;
  /** Deployment region */
  location: string;
  /** Resource tags as key-value pairs */
  tags: Record<string, string>;
  /** ISO-8601 status date */
  statusDate: string;
}

/** A generated optimization recommendation */
export interface Recommendation {
  /** Unique identifier for this recommendation instance */
  recommendationId: string;
  /** ISO-8601 generation timestamp */
  generatedDate: string;
  /** Stable recommender identifier */
  recommenderId: string;
  /** Human-readable recommender name */
  recommenderName: string;
  /** Source cloud */
  cloud: CloudProvider;
  /** FinOps category */
  category: RecommendationCategory;
  /** Azure resource type or equivalent (e.g., Microsoft.Compute/virtualMachines) */
  impactedArea: string;
  /** Impact level */
  impact: RecommendationImpact;
  /** Top-level recommendation type (e.g., "All") */
  recommendationType: string;
  /** Specific subtype name (e.g., "LongDeallocatedVms") */
  recommendationSubType: string;
  /** Stable GUID for the recommendation subtype */
  recommendationSubTypeId: string;
  /** Human-readable description */
  recommendationDescription: string;
  /** Suggested action */
  recommendationAction: string;
  /** Fully qualified resource ID */
  instanceId: string;
  /** Short display name */
  instanceName: string;
  /** Resource group / equivalent */
  resourceGroup: string;
  /** Subscription / account / project ID */
  subscriptionId: string;
  /** Subscription / account / project display name */
  subscriptionName: string;
  /** Tenant / organization ID */
  tenantId: string;
  /** Confidence score from 1 (low) to 5 (high) */
  fitScore: number;
  /** Resource tags */
  tags: Record<string, string>;
  /** Link to more details */
  detailsUrl: string;
  /** Recommendation-specific payload (thresholds, costs, metrics) */
  additionalInfo: Record<string, unknown>;
}

/** A user-defined suppression rule */
export interface Suppression {
  filterId: string;
  recommendationSubTypeId: string;
  filterType: FilterType;
  instanceId: string | null;
  filterStartDate: string;
  filterEndDate: string | null;
  author: string | null;
  notes: string | null;
  isEnabled: boolean;
}

/** Tracks incremental ingestion progress per data source */
export interface IngestionControl {
  /** Storage container or data source identifier */
  sourceId: string;
  /** Last successfully processed timestamp */
  lastProcessedDateTime: string;
  /** Last processed record marker (line number, offset, etc.) */
  lastProcessedMarker: string;
  /** ADX target table suffix */
  targetTableSuffix: string;
  /** Logical data type identifier */
  collectedType: string;
}

/** Result of a remediation action */
export interface RemediationLog {
  remediationId: string;
  recommendationId: string;
  cloud: CloudProvider;
  instanceId: string;
  action: string;
  status: 'Succeeded' | 'Failed' | 'Pending' | 'Skipped';
  executedAt: string;
  executedBy: string;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Cost data model
// ---------------------------------------------------------------------------

/** Normalized cost/consumption record across clouds */
export interface CostRecord {
  timestamp: string;
  cloud: CloudProvider;
  subscriptionId: string;
  resourceGroup: string;
  instanceId: string;
  meterCategory: string;
  meterSubCategory: string;
  meterName: string;
  unitOfMeasure: string;
  quantity: number;
  cost: number;
  currency: string;
  billingPeriod: string;
  tags: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Metric data model
// ---------------------------------------------------------------------------

/** Normalized performance metric record */
export interface MetricRecord {
  timestamp: string;
  cloud: CloudProvider;
  subscriptionId: string;
  instanceId: string;
  metricName: string;
  aggregationType: 'Average' | 'Maximum' | 'Minimum' | 'Total' | 'Percentile99';
  aggregationOfType?: 'Average' | 'Maximum' | 'Minimum' | 'Total';
  value: number;
  unit: string;
  timeGrain?: string;
  timeSpan?: string;
}

// ---------------------------------------------------------------------------
// Plugin interfaces — implement per cloud provider
// ---------------------------------------------------------------------------

/** Configuration passed to every collector/recommender/remediator */
export interface EngineContext {
  /** Cloud environment (e.g., AzureCloud) */
  cloudEnvironment: string;
  /** ADX cluster URI */
  adxClusterUri: string;
  /** ADX database name */
  adxDatabase: string;
  /** Storage account for staging data */
  storageAccountName: string;
  /** Reference region for pricing/SKU lookups */
  referenceRegion: string;
  /** Number of days to offset consumption data */
  consumptionOffsetDays: number;
  /** Number of days of consumption data to collect per run (default 30) */
  consumptionCollectionDays: number;
  /** Number of days a VM must be deallocated to trigger recommendation */
  longDeallocatedVmDays: number;
  /** Number of days before credential expiration to trigger alert */
  aadExpiringCredsDays: number;
  /** Maximum recommended credential validity period before flagging */
  aadMaxCredValidityDays: number;
  /** Target subscription IDs (empty = all accessible) */
  targetSubscriptions: string[];
}

/** A collector gathers raw resource data from a cloud provider */
export interface ICollector {
  /** Unique identifier for this collector (e.g., "azure-vm") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Cloud provider */
  readonly cloud: CloudProvider;
  /** Storage container / ADX table target suffix */
  readonly targetSuffix: string;

  /**
   * Collect resource data and upload to blob storage as Parquet files.
   * Returns the number of records collected.
   */
  collect(context: EngineContext): Promise<number>;
}

/** A recommender analyzes collected data and produces recommendations */
export interface IRecommender {
  /** Unique identifier (e.g., "long-deallocated-vms") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Cloud provider */
  readonly cloud: CloudProvider;
  /** The recommendation subtypes this recommender can generate */
  readonly subTypes: RecommenderSubType[];

  /**
   * Generate recommendations by querying ADX and applying domain logic.
   * Returns generated recommendations.
   */
  generateRecommendations(context: EngineContext): Promise<Recommendation[]>;
}

/** Metadata for a recommendation subtype */
export interface RecommenderSubType {
  subType: string;
  subTypeId: string;
  category: RecommendationCategory;
  impact: RecommendationImpact;
  impactedArea: string;
  description: string;
  action: string;
}

/** A remediator can automatically fix an issue identified by a recommendation */
export interface IRemediator {
  /** Unique identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Cloud provider */
  readonly cloud: CloudProvider;
  /** Recommendation subtype IDs this remediator handles */
  readonly handlesSubTypeIds: string[];

  /**
   * Execute remediation for a single recommendation.
   * Disabled by default — must be explicitly enabled.
   */
  remediate(recommendation: Recommendation, context: EngineContext): Promise<RemediationLog>;
}

/** Registry of all plugins for a cloud provider */
export interface ICloudProvider {
  readonly cloud: CloudProvider;
  readonly collectors: ICollector[];
  readonly recommenders: IRecommender[];
  readonly remediators: IRemediator[];
}
