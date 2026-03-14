import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender } from './base-recommender.js';
import { numberSetting } from './resource-optimization-helpers.js';

const SUB_TYPES = {
  highRbacAssignmentsSubscriptions: {
    subType: 'HighRBACAssignmentsSubscriptions',
    subTypeId: 'c6a88d8c-3242-44b0-9793-c91897ef68bc',
    category: 'OperationalExcellence',
    impact: 'High',
    impactedArea: 'Microsoft.Resources/subscriptions',
    description: 'Subscriptions close to the maximum limit of RBAC assignments',
    action: 'Remove unneeded RBAC assignments or use group-based (or nested group-based) assignments',
  },
  highRbacAssignmentsManagementGroups: {
    subType: 'HighRBACAssignmentsManagementGroups',
    subTypeId: 'b36dea3e-ef21-45a9-a704-6f629fab236d',
    category: 'OperationalExcellence',
    impact: 'High',
    impactedArea: 'Microsoft.Management/managementGroups',
    description: 'Management Groups close to the maximum limit of RBAC assignments',
    action: 'Remove unneeded RBAC assignments or use group-based (or nested group-based) assignments',
  },
  highResourceGroupCountSubscriptions: {
    subType: 'HighResourceGroupCountSubscriptions',
    subTypeId: '4468da8d-1e72-4998-b6d2-3bc38ddd9330',
    category: 'OperationalExcellence',
    impact: 'High',
    impactedArea: 'Microsoft.Resources/subscriptions',
    description: 'Subscriptions close to the maximum limit of resource groups',
    action: 'Remove unneeded resource groups or split your resource groups across multiple subscriptions',
  },
} satisfies Record<string, RecommenderSubType>;

type SubscriptionAssignmentRow = {
  SubscriptionId: string;
  SubscriptionName: string;
  InstanceId: string;
  TenantId: string;
  Tags: Record<string, string>;
  AssignmentsCount: number;
};

type ManagementGroupAssignmentRow = {
  Scope: string;
  ManagementGroupId: string;
  TenantId: string;
  AssignmentsCount: number;
};

type ResourceGroupLimitRow = {
  SubscriptionId: string;
  SubscriptionName: string;
  InstanceId: string;
  TenantId: string;
  Tags: Record<string, string>;
  RGCount: number;
};

export class ArmOptimizationsRecommender extends AzureRecommender {
  readonly id = 'arm-optimizations';
  readonly name = 'ARM optimizations';
  readonly subTypes = Object.values(SUB_TYPES);

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const assignmentPercentageThreshold = numberSetting('OE_RECOMMEND_RBAC_ASSIGNMENTS_PERCENTAGE_THRESHOLD', 80);
    const assignmentsSubscriptionsLimit = numberSetting('OE_RECOMMEND_RBAC_SUBSCRIPTIONS_ASSIGNMENTS_LIMIT', 4000);
    const assignmentsMgmtGroupsLimit = numberSetting('OE_RECOMMEND_RBAC_MGMT_GROUPS_ASSIGNMENTS_LIMIT', 500);
    const resourceGroupsPercentageThreshold = numberSetting('OE_RECOMMEND_RESOURCE_GROUPS_PER_SUB_PERCENTAGE_THRESHOLD', 80);
    const resourceGroupsLimit = numberSetting('OE_RECOMMEND_RESOURCE_GROUPS_PER_SUB_LIMIT', 980);

    const subscriptionAssignmentsThreshold = assignmentsSubscriptionsLimit * (assignmentPercentageThreshold / 100);
    const managementGroupAssignmentsThreshold = assignmentsMgmtGroupsLimit * (assignmentPercentageThreshold / 100);
    const resourceGroupsThreshold = resourceGroupsLimit * (resourceGroupsPercentageThreshold / 100);

    const subscriptionAssignmentsKql = `
      let subscriptionContainers = ResourceContainers
        | where ContainerType =~ 'Subscription'
        | summarize arg_max(Timestamp, *) by SubscriptionId
        | project SubscriptionId, SubscriptionName = ContainerName, InstanceId, TenantId, Tags;
      RBACAssignments
      | where Timestamp > ago(1d) and Scope startswith '/subscriptions/'
      | extend SubscriptionId = tostring(split(Scope, '/')[2])
      | summarize AssignmentsCount = count() by SubscriptionId
      | where AssignmentsCount >= ${subscriptionAssignmentsThreshold}
      | join kind=leftouter subscriptionContainers on SubscriptionId
      | project SubscriptionId, SubscriptionName, InstanceId, TenantId, Tags, AssignmentsCount
    `;

    const managementGroupsKql = `
      let tenantId = toscalar(ResourceContainers | where ContainerType =~ 'Subscription' | summarize any(TenantId));
      RBACAssignments
      | where Timestamp > ago(1d) and Scope has 'managementGroups'
      | extend ManagementGroupId = tostring(split(Scope, '/')[4])
      | summarize AssignmentsCount = count(), Scope = any(Scope) by ManagementGroupId
      | where AssignmentsCount >= ${managementGroupAssignmentsThreshold}
      | extend TenantId = tenantId
      | project Scope, ManagementGroupId, TenantId, AssignmentsCount
    `;

    const resourceGroupsKql = `
      let subscriptionContainers = ResourceContainers
        | where ContainerType =~ 'Subscription'
        | summarize arg_max(Timestamp, *) by SubscriptionId
        | project SubscriptionId, SubscriptionName = ContainerName, InstanceId, TenantId, Tags;
      ResourceContainers
      | where ContainerType =~ 'ResourceGroup'
      | summarize RGCount = count() by SubscriptionId
      | where RGCount >= ${resourceGroupsThreshold}
      | join kind=leftouter subscriptionContainers on SubscriptionId
      | project SubscriptionId, SubscriptionName, InstanceId, TenantId, Tags, RGCount
    `;

    const [subscriptionAssignments, managementGroups, resourceGroupCounts] = await Promise.all([
      this.queryAdx<SubscriptionAssignmentRow>(ctx, subscriptionAssignmentsKql),
      this.queryAdx<ManagementGroupAssignmentRow>(ctx, managementGroupsKql),
      this.queryAdx<ResourceGroupLimitRow>(ctx, resourceGroupsKql),
    ]);

    const recommendations: Recommendation[] = [];

    for (const row of subscriptionAssignments) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.highRbacAssignmentsSubscriptions, {
          instanceId: row.InstanceId,
          instanceName: row.SubscriptionName,
          resourceGroup: '',
          subscriptionId: row.SubscriptionId,
          subscriptionName: row.SubscriptionName,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: 5,
          detailsUrl: `https://portal.azure.com/#@${row.TenantId}/resource${row.InstanceId}/users`,
          additionalInfo: {
            assignmentsCount: row.AssignmentsCount,
          },
        }),
      );
    }

    for (const row of managementGroups) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.highRbacAssignmentsManagementGroups, {
          instanceId: row.Scope,
          instanceName: row.ManagementGroupId,
          resourceGroup: '',
          subscriptionId: '',
          tenantId: row.TenantId,
          tags: {},
          fitScore: 5,
          detailsUrl: `https://portal.azure.com/#@${row.TenantId}/blade/Microsoft_Azure_ManagementGroups/ManagementGroupBrowseBlade/MGBrowse_overview`,
          additionalInfo: {
            assignmentsCount: row.AssignmentsCount,
          },
        }),
      );
    }

    for (const row of resourceGroupCounts) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.highResourceGroupCountSubscriptions, {
          instanceId: row.InstanceId,
          instanceName: row.SubscriptionName,
          resourceGroup: '',
          subscriptionId: row.SubscriptionId,
          subscriptionName: row.SubscriptionName,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: 5,
          detailsUrl: `https://portal.azure.com/#@${row.TenantId}/resource${row.InstanceId}/resourceGroups`,
          additionalInfo: {
            resourceGroupsCount: row.RGCount,
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
