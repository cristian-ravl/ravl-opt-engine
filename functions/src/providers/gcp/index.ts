// GCP Cloud Provider — scaffold for GCP collectors, recommenders, and remediators.
// Collectors use Google Cloud client libraries to query GCP resources via
// Asset Inventory, BigQuery billing export, Cloud Monitoring, and Recommender API.

import type { ICloudProvider, ICollector, IRecommender, IRemediator } from '../types.js';

export class GcpProvider implements ICloudProvider {
  readonly cloud = 'GCP' as const;

  // GCP collectors will use:
  // - Cloud Asset Inventory for resource inventory (Compute, Cloud SQL, GKE, etc.)
  // - BigQuery billing export for cost data
  // - Cloud Monitoring for metrics
  // - Recommender API for existing GCP optimization recommendations
  readonly collectors: ICollector[] = [
    // TODO: Implement GCP collectors
    // new ComputeInstanceCollector(),
    // new PersistentDiskCollector(),
    // new CloudSqlCollector(),
    // new GkeClusterCollector(),
    // new CloudStorageBucketCollector(),
    // new GcpBillingCollector(),
    // new CloudMonitoringCollector(),
    // new GcpRecommenderCollector(),
  ];

  readonly recommenders: IRecommender[] = [
    // TODO: Implement GCP recommenders
    // new IdleComputeRecommender(),
    // new UnattachedDiskRecommender(),
    // new IdleCloudSqlRecommender(),
    // new StorageClassRecommender(),
  ];

  readonly remediators: IRemediator[] = [];
}
