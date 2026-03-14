// Recommender: Unattached managed disks with no owner VM

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'UnattachedDisks',
  subTypeId: 'c84d5e86-e2d6-4d62-be7c-cecfbd73b0db',
  category: 'Cost',
  impact: 'Medium',
  impactedArea: 'Microsoft.Compute/disks',
  description: 'Managed disk is unattached (no owner VM) and incurring unnecessary costs',
  action: 'Delete the disk or downgrade to Standard SKU to reduce costs',
};

export class UnattachedDisksRecommender extends AzureRecommender {
  readonly id = 'unattached-disks';
  readonly name = 'Unattached Disks';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const kql = `
      LatestDisks
      | where isempty(OwnerVMId)
      | where not(Tags has "ASR-ReplicaDisk") and not(Tags has "asrseeddisk")
      | join kind=leftouter (
          CostData
          | where Timestamp > ago(30d)
          | where MeterCategory has "Storage" or MeterCategory has "Disks"
          | summarize DiskCost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, DiskName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, DiskSizeGB, SKU, DiskState, DiskCost30d = coalesce(DiskCost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;

    const results = await this.queryAdx<{
      InstanceId: string;
      DiskName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      DiskSizeGB: number;
      SKU: string;
      DiskState: string;
      DiskCost30d: number;
      Currency: string;
    }>(ctx, kql);

    const recommendations = results.map((disk) =>
      this.createRecommendation(SUB_TYPE, {
        instanceId: disk.InstanceId,
        instanceName: disk.DiskName,
        resourceGroup: disk.ResourceGroup,
        subscriptionId: disk.SubscriptionId,
        tenantId: disk.TenantId,
        tags: disk.Tags,
        fitScore: 5,
        additionalInfo: {
          diskSizeGB: disk.DiskSizeGB,
          currentSku: disk.SKU,
          diskState: disk.DiskState,
          location: disk.Location,
          monthlyCost: disk.DiskCost30d,
          annualSavings: disk.DiskCost30d * 12,
          currency: disk.Currency,
        },
      }),
    );

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
