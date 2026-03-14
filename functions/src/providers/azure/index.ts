// Azure cloud provider — registers all Azure collectors, recommenders, and remediators.

import type { ICloudProvider, ICollector, IRecommender, IRemediator } from '../types.js';
import {
  VirtualMachinesCollector,
  ManagedDisksCollector,
  AppServicePlanCollector,
  LoadBalancerCollector,
  NicCollector,
  NsgCollector,
  PublicIpCollector,
  ResourceContainerCollector,
  SqlDatabaseCollector,
  VmssCollector,
  VnetCollector,
  AppGatewayCollector,
  AvailabilitySetCollector,
  UnmanagedDisksCollector,
  ConsumptionCostCollector,
  MonitorMetricsCollector,
  AdvisorRecommendationsCollector,
  PriceSheetCollector,
  ReservationsPriceCollector,
  ReservationsUsageCollector,
  SavingsPlansUsageCollector,
  AadObjectsCollector,
  RbacAssignmentsCollector,
  PolicyComplianceCollector,
} from './collectors/index.js';
import {
  LongDeallocatedVmsRecommender,
  StoppedVmsRecommender,
  UnattachedDisksRecommender,
  UnusedAppGatewaysRecommender,
  UnusedLoadBalancersRecommender,
  VmHighAvailabilityRecommender,
  VnetOptimizationsRecommender,
  AppServiceOptimizationsRecommender,
  AdvisorAsIsRecommender,
  AdvisorCostAugmentedRecommender,
  VmOptimizationsRecommender,
  VmssOptimizationsRecommender,
  DiskOptimizationsRecommender,
  SqlDbOptimizationsRecommender,
  StorageAccountOptimizationsRecommender,
  ArmOptimizationsRecommender,
  AadExpiringCredentialsRecommender,
} from './recommenders/index.js';
import {
  AdvisorRightsizeRemediator,
  LongDeallocatedVmsRemediator,
  UnattachedDisksRemediator,
} from './remediators/index.js';

export class AzureProvider implements ICloudProvider {
  readonly cloud = 'Azure' as const;

  readonly collectors: ICollector[] = [
    new VirtualMachinesCollector(),
    new ManagedDisksCollector(),
    new AppServicePlanCollector(),
    new LoadBalancerCollector(),
    new NicCollector(),
    new NsgCollector(),
    new PublicIpCollector(),
    new ResourceContainerCollector(),
    new SqlDatabaseCollector(),
    new VmssCollector(),
    new VnetCollector(),
    new AppGatewayCollector(),
    new AvailabilitySetCollector(),
    new UnmanagedDisksCollector(),
    new ConsumptionCostCollector(),
    new MonitorMetricsCollector(),
    new AdvisorRecommendationsCollector(),
    new PriceSheetCollector(),
    new ReservationsPriceCollector(),
    new ReservationsUsageCollector(),
    new SavingsPlansUsageCollector(),
    new AadObjectsCollector(),
    new RbacAssignmentsCollector(),
    new PolicyComplianceCollector(),
  ];

  readonly recommenders: IRecommender[] = [
    new LongDeallocatedVmsRecommender(),
    new StoppedVmsRecommender(),
    new UnattachedDisksRecommender(),
    new UnusedAppGatewaysRecommender(),
    new UnusedLoadBalancersRecommender(),
    new VmHighAvailabilityRecommender(),
    new VnetOptimizationsRecommender(),
    new AppServiceOptimizationsRecommender(),
    new AdvisorAsIsRecommender(),
    new AdvisorCostAugmentedRecommender(),
    new VmOptimizationsRecommender(),
    new VmssOptimizationsRecommender(),
    new DiskOptimizationsRecommender(),
    new SqlDbOptimizationsRecommender(),
    new StorageAccountOptimizationsRecommender(),
    new ArmOptimizationsRecommender(),
    new AadExpiringCredentialsRecommender(),
  ];

  readonly remediators: IRemediator[] = [
    new AdvisorRightsizeRemediator(),
    new LongDeallocatedVmsRemediator(),
    new UnattachedDisksRemediator(),
  ];
}
