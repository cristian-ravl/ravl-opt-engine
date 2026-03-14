// Recommender: VNet optimizations — orphaned NICs, orphaned Public IPs,
// subnet IP space usage, NSG rule hygiene.

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPES: Record<string, RecommenderSubType> = {
  highSubnetUsage: {
    subType: 'HighSubnetIPSpaceUsage',
    subTypeId: '5292525b-5095-4e52-803e-e17192f1d099',
    category: 'OperationalExcellence',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/virtualNetworks',
    description: 'Subnet has high IP space usage which may constrain operations',
    action: 'Move devices to a larger subnet or add more address space',
  },
  lowSubnetUsage: {
    subType: 'LowSubnetIPSpaceUsage',
    subTypeId: '0f27b41c-869a-4563-86e9-d1c94232ba81',
    category: 'OperationalExcellence',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/virtualNetworks',
    description: 'Subnet has low IP space usage, wasting address space',
    action: 'Move devices to a smaller subnet to reclaim address space',
  },
  emptySubnet: {
    subType: 'NoSubnetIPSpaceUsage',
    subTypeId: '343bbfb7-5bec-4711-8353-398454d42b7b',
    category: 'OperationalExcellence',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/virtualNetworks',
    description: 'Subnet has no IP usage and wastes address space',
    action: 'Delete the subnet to reclaim address space',
  },
  orphanedNIC: {
    subType: 'OrphanedNIC',
    subTypeId: '4c5c2d0c-b6a4-4c59-bc18-6fff6c1f5b23',
    category: 'OperationalExcellence',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/networkInterfaces',
    description: 'Orphaned NIC consumes IP address space',
    action: 'Delete the NIC',
  },
  orphanedPublicIP: {
    subType: 'OrphanedPublicIP',
    subTypeId: '3125883f-8b9f-4bde-a0ff-6c739858c6e1',
    category: 'Cost',
    impact: 'Low',
    impactedArea: 'Microsoft.Network/publicIPAddresses',
    description: 'Orphaned Public IP incurs unnecessary costs',
    action: 'Delete or change to dynamic allocation',
  },
  nsgRuleEmptyOrMissingSubnet: {
    subType: 'NSGRuleForEmptyOrUnexistingSubnet',
    subTypeId: 'b5491cde-f76c-4423-8c4c-89e3558ff2f2',
    category: 'Security',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/networkSecurityGroups',
    description: 'NSG rule refers to an empty or missing subnet',
    action: 'Update or remove the NSG rule to improve network security posture',
  },
  nsgRuleOrphanOrMissingNic: {
    subType: 'NSGRuleForOrphanOrUnexistingNIC',
    subTypeId: '3dc1d1f8-19ef-4572-9c9d-78d62831f55a',
    category: 'Security',
    impact: 'Medium',
    impactedArea: 'Microsoft.Network/networkSecurityGroups',
    description: 'NSG rule refers to an orphaned or missing NIC',
    action: 'Update or remove the NSG rule to improve network security posture',
  },
  nsgRuleOrphanOrMissingPublicIP: {
    subType: 'NSGRuleForOrphanOrUnexistingPublicIP',
    subTypeId: 'fe40cbe7-bdee-4cce-b072-cf25e1247b7a',
    category: 'Security',
    impact: 'High',
    impactedArea: 'Microsoft.Network/networkSecurityGroups',
    description: 'NSG rule refers to an orphaned or missing Public IP',
    action: 'Update or remove the NSG rule to improve network security posture',
  },
};

const HIGH_USAGE_THRESHOLD = 0.8;
const LOW_USAGE_THRESHOLD = 0.2;

export class VnetOptimizationsRecommender extends AzureRecommender {
  readonly id = 'vnet-optimizations';
  readonly name = 'VNet Optimizations';
  readonly subTypes = Object.values(SUB_TYPES);

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // 1. Subnet IP space usage
    const subnetKql = `
      VirtualNetworks
      | summarize arg_max(Timestamp, *) by InstanceId, SubnetName
      | where SubnetTotalPrefixIPs > 0
      | extend usageRatio = todouble(SubnetUsedIPs) / todouble(SubnetTotalPrefixIPs)
      | project InstanceId, VNetName, SubnetName, SubnetPrefix, SubnetTotalPrefixIPs, SubnetUsedIPs, usageRatio, ResourceGroup, SubscriptionId, TenantId, Tags, Location
    `;
    const subnets = await this.queryAdx<{
      InstanceId: string;
      VNetName: string;
      SubnetName: string;
      SubnetPrefix: string;
      SubnetTotalPrefixIPs: number;
      SubnetUsedIPs: number;
      usageRatio: number;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
    }>(ctx, subnetKql);

    for (const subnet of subnets) {
      if (subnet.SubnetUsedIPs === 0 && subnet.SubnetName !== 'gatewaysubnet') {
        const fitScore = Math.min(5, Math.max(1, Math.round(subnet.SubnetTotalPrefixIPs / 64)));
        recommendations.push(
          this.createRecommendation(SUB_TYPES.emptySubnet, {
            instanceId: subnet.InstanceId,
            instanceName: `${subnet.VNetName}/${subnet.SubnetName}`,
            resourceGroup: subnet.ResourceGroup,
            subscriptionId: subnet.SubscriptionId,
            tenantId: subnet.TenantId,
            tags: subnet.Tags,
            fitScore,
            additionalInfo: {
              subnetPrefix: subnet.SubnetPrefix,
              totalIPs: subnet.SubnetTotalPrefixIPs,
              location: subnet.Location,
            },
          }),
        );
      } else if (subnet.usageRatio > HIGH_USAGE_THRESHOLD) {
        const fitScore = Math.min(5, Math.max(1, Math.round(subnet.usageRatio * 5)));
        recommendations.push(
          this.createRecommendation(SUB_TYPES.highSubnetUsage, {
            instanceId: subnet.InstanceId,
            instanceName: `${subnet.VNetName}/${subnet.SubnetName}`,
            resourceGroup: subnet.ResourceGroup,
            subscriptionId: subnet.SubscriptionId,
            tenantId: subnet.TenantId,
            tags: subnet.Tags,
            fitScore,
            additionalInfo: {
              subnetPrefix: subnet.SubnetPrefix,
              totalIPs: subnet.SubnetTotalPrefixIPs,
              usedIPs: subnet.SubnetUsedIPs,
              usagePercent: Math.round(subnet.usageRatio * 100),
            },
          }),
        );
      } else if (subnet.usageRatio < LOW_USAGE_THRESHOLD && subnet.SubnetUsedIPs > 0) {
        const fitScore = Math.min(5, Math.max(1, Math.round((1 - subnet.usageRatio) * 3)));
        recommendations.push(
          this.createRecommendation(SUB_TYPES.lowSubnetUsage, {
            instanceId: subnet.InstanceId,
            instanceName: `${subnet.VNetName}/${subnet.SubnetName}`,
            resourceGroup: subnet.ResourceGroup,
            subscriptionId: subnet.SubscriptionId,
            tenantId: subnet.TenantId,
            tags: subnet.Tags,
            fitScore,
            additionalInfo: {
              subnetPrefix: subnet.SubnetPrefix,
              totalIPs: subnet.SubnetTotalPrefixIPs,
              usedIPs: subnet.SubnetUsedIPs,
              usagePercent: Math.round(subnet.usageRatio * 100),
            },
          }),
        );
      }
    }

    // 2. Orphaned NICs
    const nicKql = `
      NetworkInterfaces
      | summarize arg_max(Timestamp, *) by InstanceId
      | where isempty(OwnerVMId) and isempty(OwnerPEId)
    `;
    const orphanedNics = await this.queryAdx<{
      InstanceId: string;
      Name: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
    }>(ctx, nicKql);

    for (const nic of orphanedNics) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.orphanedNIC, {
          instanceId: nic.InstanceId,
          instanceName: nic.Name,
          resourceGroup: nic.ResourceGroup,
          subscriptionId: nic.SubscriptionId,
          tenantId: nic.TenantId,
          tags: nic.Tags,
          fitScore: 3,
          additionalInfo: { location: nic.Location },
        }),
      );
    }

    // 3. Orphaned Public IPs
    const pipKql = `
      PublicIPs
      | summarize arg_max(Timestamp, *) by InstanceId
      | where isempty(AssociatedResourceId) and AllocationMethod == "static"
      | join kind=leftouter (
          LatestCostData
          | where UsageDate >= ago(30d) and MeterCategory has "IP Address"
          | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, Name, ResourceGroup, SubscriptionId, TenantId, Tags, Location, IPAddress, AllocationMethod, Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;
    const orphanedPips = await this.queryAdx<{
      InstanceId: string;
      Name: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      IPAddress: string;
      AllocationMethod: string;
      Cost30d: number;
      Currency: string;
    }>(ctx, pipKql);

    for (const pip of orphanedPips) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.orphanedPublicIP, {
          instanceId: pip.InstanceId,
          instanceName: pip.Name,
          resourceGroup: pip.ResourceGroup,
          subscriptionId: pip.SubscriptionId,
          tenantId: pip.TenantId,
          tags: pip.Tags,
          fitScore: 3,
          additionalInfo: {
            ipAddress: pip.IPAddress,
            allocationMethod: pip.AllocationMethod,
            monthlyCost: pip.Cost30d,
            annualSavings: pip.Cost30d * 12,
            currency: pip.Currency,
          },
        }),
      );
    }

    // 4. NSG rules targeting empty or removed subnets
    const nsgSubnetKql = `
      let currentSubnets = VirtualNetworks
        | summarize arg_max(Timestamp, *) by InstanceId, SubnetName
        | extend SubnetId = strcat(tolower(InstanceId), '/subnets/', tolower(SubnetName));
      let previousSubnets = VirtualNetworks
        | where Timestamp < ago(1d)
        | summarize arg_max(Timestamp, *) by InstanceId, SubnetName
        | extend SubnetId = strcat(tolower(InstanceId), '/subnets/', tolower(SubnetName));
      let emptySubnets = currentSubnets
        | where SubnetUsedIPs == 0
        | extend SubnetState = 'empty'
        | project SubnetId, SubnetPrefix, SubnetState;
      let currentSubnetIds = currentSubnets | distinct SubnetId;
      let currentSubnetPrefixes = currentSubnets | distinct SubnetPrefix;
      let removedSubnets = previousSubnets
        | where SubnetId !in (currentSubnetIds) and SubnetPrefix !in (currentSubnetPrefixes)
        | extend SubnetState = 'unexisting'
        | project SubnetId, SubnetPrefix, SubnetState;
      let candidateSubnets = union emptySubnets, removedSubnets;
      let nsgRules = materialize(
        NetworkSecurityGroups
        | summarize arg_max(Timestamp, *) by InstanceId, RuleName
        | extend SourceAddresses = split(RuleSourceAddresses, ',')
        | mv-expand SourceAddress = SourceAddresses to typeof(string)
        | extend SourceAddress = replace('/32', '', tostring(SourceAddress))
        | extend DestinationAddresses = split(RuleDestinationAddresses, ',')
        | mv-expand DestinationAddress = DestinationAddresses to typeof(string)
        | extend DestinationAddress = replace('/32', '', tostring(DestinationAddress))
        | project NSGId = InstanceId, NSGName, RuleName, SourceAddress, DestinationAddress, ResourceGroup, SubscriptionId, TenantId, Tags
      );
      let sourceMatches = candidateSubnets
        | join kind=inner nsgRules on $left.SubnetPrefix == $right.SourceAddress;
      let destinationMatches = candidateSubnets
        | join kind=inner nsgRules on $left.SubnetPrefix == $right.DestinationAddress;
      sourceMatches
      | union destinationMatches
      | distinct NSGId, NSGName, RuleName, ResourceGroup, SubscriptionId, TenantId, Tags, SubnetId, SubnetPrefix, SubnetState
    `;
    const subnetRuleMatches = await this.queryAdx<{
      NSGId: string;
      NSGName: string;
      RuleName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      SubnetId: string;
      SubnetPrefix: string;
      SubnetState: string;
    }>(ctx, nsgSubnetKql);

    for (const match of subnetRuleMatches) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.nsgRuleEmptyOrMissingSubnet, {
          instanceId: match.NSGId,
          instanceName: `${match.NSGName}/${match.RuleName}`,
          resourceGroup: match.ResourceGroup,
          subscriptionId: match.SubscriptionId,
          tenantId: match.TenantId,
          tags: match.Tags,
          fitScore: 5,
          additionalInfo: {
            subnetId: match.SubnetId,
            subnetPrefix: match.SubnetPrefix,
            subnetState: match.SubnetState,
          },
        }),
      );
    }

    // 5. NSG rules targeting orphaned or removed NICs
    const nsgNicKql = `
      let currentPublicIps = PublicIPs
        | summarize arg_max(Timestamp, *) by InstanceId
        | project PublicIPId = tolower(InstanceId), PublicIPAddress = IPAddress;
      let previousPublicIps = PublicIPs
        | where Timestamp < ago(1d)
        | summarize arg_max(Timestamp, *) by InstanceId
        | project PublicIPId = tolower(InstanceId), PublicIPAddress = IPAddress;
      let currentNics = NetworkInterfaces
        | summarize arg_max(Timestamp, *) by InstanceId, PrivateIPAddress, PublicIPId;
      let previousNics = NetworkInterfaces
        | where Timestamp < ago(1d)
        | summarize arg_max(Timestamp, *) by InstanceId, PrivateIPAddress, PublicIPId;
      let orphanNics = currentNics
        | where isempty(OwnerVMId) and isempty(OwnerPEId)
        | join kind=leftouter currentPublicIps on $left.PublicIPId == $right.PublicIPId
        | extend NicState = 'orphan';
      let currentNicIds = currentNics | distinct InstanceId;
      let currentNicIps = currentNics | distinct PrivateIPAddress;
      let removedNics = previousNics
        | where InstanceId !in (currentNicIds) and PrivateIPAddress !in (currentNicIps)
        | join kind=leftouter previousPublicIps on $left.PublicIPId == $right.PublicIPId
        | extend NicState = 'unexisting';
      let nsgRules = materialize(
        NetworkSecurityGroups
        | summarize arg_max(Timestamp, *) by InstanceId, RuleName
        | extend SourceAddresses = split(RuleSourceAddresses, ',')
        | mv-expand SourceAddress = SourceAddresses to typeof(string)
        | extend SourceAddress = replace('/32', '', tostring(SourceAddress))
        | extend DestinationAddresses = split(RuleDestinationAddresses, ',')
        | mv-expand DestinationAddress = DestinationAddresses to typeof(string)
        | extend DestinationAddress = replace('/32', '', tostring(DestinationAddress))
        | project NSGId = InstanceId, NSGName, RuleName, SourceAddress, DestinationAddress, ResourceGroup, SubscriptionId, TenantId, Tags
      );
      let privateSourceMatches = orphanNics
        | union removedNics
        | where isnotempty(PrivateIPAddress)
        | join kind=inner nsgRules on $left.PrivateIPAddress == $right.SourceAddress
        | extend IPAddress = PrivateIPAddress;
      let privateDestinationMatches = orphanNics
        | union removedNics
        | where isnotempty(PrivateIPAddress)
        | join kind=inner nsgRules on $left.PrivateIPAddress == $right.DestinationAddress
        | extend IPAddress = PrivateIPAddress;
      let publicSourceMatches = orphanNics
        | union removedNics
        | where isnotempty(PublicIPAddress)
        | join kind=inner nsgRules on $left.PublicIPAddress == $right.SourceAddress
        | extend IPAddress = PublicIPAddress;
      let publicDestinationMatches = orphanNics
        | union removedNics
        | where isnotempty(PublicIPAddress)
        | join kind=inner nsgRules on $left.PublicIPAddress == $right.DestinationAddress
        | extend IPAddress = PublicIPAddress;
      privateSourceMatches
      | union privateDestinationMatches
      | union publicSourceMatches
      | union publicDestinationMatches
      | distinct NSGId, NSGName, RuleName, ResourceGroup, SubscriptionId, TenantId, Tags, InstanceId, IPAddress, NicState
    `;
    const nicRuleMatches = await this.queryAdx<{
      NSGId: string;
      NSGName: string;
      RuleName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      InstanceId: string;
      IPAddress: string;
      NicState: string;
    }>(ctx, nsgNicKql);

    for (const match of nicRuleMatches) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.nsgRuleOrphanOrMissingNic, {
          instanceId: match.NSGId,
          instanceName: `${match.NSGName}/${match.RuleName}`,
          resourceGroup: match.ResourceGroup,
          subscriptionId: match.SubscriptionId,
          tenantId: match.TenantId,
          tags: match.Tags,
          fitScore: 5,
          additionalInfo: {
            nicId: match.InstanceId,
            ipAddress: match.IPAddress,
            nicState: match.NicState,
          },
        }),
      );
    }

    // 6. NSG rules targeting orphaned or removed Public IPs
    const nsgPublicIpKql = `
      let currentPublicIps = PublicIPs
        | summarize arg_max(Timestamp, *) by InstanceId
        | project InstanceId, IPAddress, AssociatedResourceId, AllocationMethod;
      let previousPublicIps = PublicIPs
        | where Timestamp < ago(1d)
        | summarize arg_max(Timestamp, *) by InstanceId
        | project InstanceId, IPAddress, AllocationMethod;
      let orphanStaticPublicIps = currentPublicIps
        | where isempty(AssociatedResourceId) and AllocationMethod == 'static'
        | extend PublicIPState = 'orphan';
      let orphanDynamicPublicIpIds = currentPublicIps
        | where isempty(AssociatedResourceId) and AllocationMethod == 'dynamic'
        | project InstanceId;
      let currentPublicIpIds = currentPublicIps | distinct InstanceId;
      let currentPublicIpAddresses = currentPublicIps | distinct IPAddress;
      let orphanDynamicPublicIps = previousPublicIps
        | where InstanceId in (orphanDynamicPublicIpIds)
        | where isnotempty(IPAddress) and IPAddress !in (currentPublicIpAddresses)
        | extend PublicIPState = 'orphan';
      let removedPublicIps = previousPublicIps
        | where InstanceId !in (currentPublicIpIds)
        | where isnotempty(IPAddress) and IPAddress !in (currentPublicIpAddresses)
        | extend PublicIPState = 'unexisting';
      let candidatePublicIps = union orphanStaticPublicIps, orphanDynamicPublicIps, removedPublicIps;
      let nsgRules = materialize(
        NetworkSecurityGroups
        | summarize arg_max(Timestamp, *) by InstanceId, RuleName
        | extend SourceAddresses = split(RuleSourceAddresses, ',')
        | mv-expand SourceAddress = SourceAddresses to typeof(string)
        | extend SourceAddress = replace('/32', '', tostring(SourceAddress))
        | extend DestinationAddresses = split(RuleDestinationAddresses, ',')
        | mv-expand DestinationAddress = DestinationAddresses to typeof(string)
        | extend DestinationAddress = replace('/32', '', tostring(DestinationAddress))
        | project NSGId = InstanceId, NSGName, RuleName, SourceAddress, DestinationAddress, ResourceGroup, SubscriptionId, TenantId, Tags
      );
      let sourceMatches = candidatePublicIps
        | join kind=inner nsgRules on $left.IPAddress == $right.SourceAddress;
      let destinationMatches = candidatePublicIps
        | join kind=inner nsgRules on $left.IPAddress == $right.DestinationAddress;
      sourceMatches
      | union destinationMatches
      | distinct NSGId, NSGName, RuleName, ResourceGroup, SubscriptionId, TenantId, Tags, InstanceId, IPAddress, PublicIPState, AllocationMethod
    `;
    const publicIpRuleMatches = await this.queryAdx<{
      NSGId: string;
      NSGName: string;
      RuleName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      InstanceId: string;
      IPAddress: string;
      PublicIPState: string;
      AllocationMethod: string;
    }>(ctx, nsgPublicIpKql);

    for (const match of publicIpRuleMatches) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.nsgRuleOrphanOrMissingPublicIP, {
          instanceId: match.NSGId,
          instanceName: `${match.NSGName}/${match.RuleName}`,
          resourceGroup: match.ResourceGroup,
          subscriptionId: match.SubscriptionId,
          tenantId: match.TenantId,
          tags: match.Tags,
          fitScore: 5,
          additionalInfo: {
            publicIPId: match.InstanceId,
            ipAddress: match.IPAddress,
            publicIPState: match.PublicIPState,
            allocationMethod: match.AllocationMethod,
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
