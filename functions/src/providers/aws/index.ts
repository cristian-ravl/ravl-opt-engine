// AWS Cloud Provider — scaffold for AWS collectors, recommenders, and remediators.
// Collectors use AWS SDK v3 to query AWS resources via AWS Config, Cost Explorer,
// CloudWatch, and Trusted Advisor.

import type { ICloudProvider, ICollector, IRecommender, IRemediator } from '../types.js';

export class AwsProvider implements ICloudProvider {
  readonly cloud = 'AWS' as const;

  // AWS collectors will use:
  // - AWS Config for resource inventory (EC2, RDS, EBS, ELB, S3, Lambda)
  // - Cost Explorer for cost data
  // - CloudWatch for metrics
  // - Trusted Advisor for existing AWS optimization recommendations
  readonly collectors: ICollector[] = [
    // TODO: Implement AWS collectors
    // new Ec2InstanceCollector(),
    // new EbsVolumeCollector(),
    // new RdsInstanceCollector(),
    // new ElbCollector(),
    // new S3BucketCollector(),
    // new LambdaFunctionCollector(),
    // new AwsCostCollector(),
    // new CloudWatchMetricsCollector(),
    // new TrustedAdvisorCollector(),
  ];

  readonly recommenders: IRecommender[] = [
    // TODO: Implement AWS recommenders
    // new UnderutilizedEc2Recommender(),
    // new UnattachedEbsRecommender(),
    // new IdleRdsRecommender(),
    // new UnusedElbRecommender(),
    // new S3StorageClassRecommender(),
  ];

  readonly remediators: IRemediator[] = [];
}
