// Recommender: Stopped VMs — VMs that are stopped (not deallocated) still incur full compute costs.

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'StoppedVms',
  subTypeId: '110fea55-a9c3-480d-8248-116f61e139a8',
  category: 'Cost',
  impact: 'High',
  impactedArea: 'Microsoft.Compute/virtualMachines',
  description: 'VM is stopped but not deallocated, still incurring full compute costs',
  action: 'Deallocate or delete the VM to stop incurring compute charges',
};

export class StoppedVmsRecommender extends AzureRecommender {
  readonly id = 'stopped-vms';
  readonly name = 'Stopped VMs';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const kql = `
      LatestVMs
      | where PowerState has "stopped" and not(PowerState has "deallocated")
      | join kind=leftouter (
          LatestCostData
          | where UsageDate >= ago(30d)
          | where MeterCategory has "Virtual Machines"
          | summarize ComputeCost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, VMSize, ComputeCost30d = coalesce(ComputeCost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;

    const results = await this.queryAdx<{
      InstanceId: string;
      VMName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      VMSize: string;
      ComputeCost30d: number;
      Currency: string;
    }>(ctx, kql);

    const recommendations = results.map((vm) =>
      this.createRecommendation(SUB_TYPE, {
        instanceId: vm.InstanceId,
        instanceName: vm.VMName,
        resourceGroup: vm.ResourceGroup,
        subscriptionId: vm.SubscriptionId,
        tenantId: vm.TenantId,
        tags: vm.Tags,
        fitScore: 5,
        additionalInfo: {
          currentSku: vm.VMSize,
          location: vm.Location,
          computeCost30d: vm.ComputeCost30d,
          annualSavings: vm.ComputeCost30d * 12,
          currency: vm.Currency,
        },
      }),
    );

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
