// Recommender: Microsoft Entra application credentials that are either expiring
// soon or configured with overly long validity periods.

import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender, uuidv4 } from './base-recommender.js';

const SUB_TYPES = {
  expiring: {
    subType: 'AADExpiringCredentials',
    subTypeId: '3292c489-2782-498b-aad0-a4cef50f6ca2',
    category: 'OperationalExcellence',
    impact: 'Medium',
    impactedArea: 'Microsoft.AzureActiveDirectory/objects',
    description: 'Microsoft Entra application with credentials expired or about to expire',
    action: 'Update the Microsoft Entra application credential before the expiration date',
  },
  notExpiring: {
    subType: 'AADNotExpiringCredentials',
    subTypeId: 'ecd969c8-3f16-481a-9577-5ed32e5e1a1d',
    category: 'Security',
    impact: 'Medium',
    impactedArea: 'Microsoft.AzureActiveDirectory/objects',
    description: 'Microsoft Entra application with credentials expiration not set or too far in time',
    action: 'Update the Microsoft Entra application credential with a shorter expiration date',
  },
} satisfies Record<string, RecommenderSubType>;

type AadCredentialRow = {
  AppId: string;
  DisplayName: string;
  CredentialType: string;
  CredentialId: string;
  EndDate: string;
  TenantId: string;
};

export class AadExpiringCredentialsRecommender extends AzureRecommender {
  readonly id = 'aad-expiring-credentials';
  readonly name = 'AAD expiring credentials';
  readonly subTypes = [SUB_TYPES.expiring, SUB_TYPES.notExpiring];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const expiringInDays = Number(process.env.OE_AAD_EXPIRING_CREDS_DAYS ?? ctx.aadExpiringCredsDays);
    const maxValidityDays = Number(process.env.OE_AAD_MAX_CRED_VALIDITY_DAYS ?? ctx.aadMaxCredValidityDays);

    const kql = `
      AADObjects
      | extend Expiry = todatetime(EndDate)
      | where isnotnull(Expiry)
      | summarize arg_min(Expiry, *) by AppId, CredentialId
      | project AppId, DisplayName, CredentialType, CredentialId, EndDate = tostring(Expiry), TenantId
    `;

    const rows = await this.queryAdx<AadCredentialRow>(ctx, kql);
    const generatedDate = new Date().toISOString();
    const expiringBoundary = Date.now() + expiringInDays * 24 * 60 * 60 * 1000;
    const maxValidityBoundary = Date.now() + maxValidityDays * 24 * 60 * 60 * 1000;
    const recommendations: Recommendation[] = [];

    for (const row of rows) {
      if (!row.AppId) continue;

      const expiry = Date.parse(row.EndDate);
      if (!Number.isFinite(expiry)) continue;

      const baseRecommendation = {
        recommendationId: uuidv4(),
        generatedDate,
        cloud: 'Azure',
        recommendationType: 'BestPractices',
        instanceId: String(row.AppId),
        instanceName: String(row.DisplayName ?? row.AppId),
        resourceGroup: '',
        subscriptionId: '',
        subscriptionName: '',
        tenantId: String(row.TenantId ?? ''),
        fitScore: 5,
        tags: {},
        detailsUrl: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/${row.AppId}`,
        additionalInfo: {
          credentialId: row.CredentialId,
          credentialType: row.CredentialType,
          expiresOn: row.EndDate,
        },
      } satisfies Omit<Recommendation, 'category' | 'impactedArea' | 'impact' | 'recommendationSubType' | 'recommendationSubTypeId' | 'recommendationDescription' | 'recommendationAction'>;

      if (expiry <= expiringBoundary) {
        recommendations.push({
          ...baseRecommendation,
          category: SUB_TYPES.expiring.category,
          impactedArea: SUB_TYPES.expiring.impactedArea,
          impact: SUB_TYPES.expiring.impact,
          recommendationSubType: SUB_TYPES.expiring.subType,
          recommendationSubTypeId: SUB_TYPES.expiring.subTypeId,
          recommendationDescription: SUB_TYPES.expiring.description,
          recommendationAction: SUB_TYPES.expiring.action,
        });
      } else if (expiry >= maxValidityBoundary) {
        recommendations.push({
          ...baseRecommendation,
          category: SUB_TYPES.notExpiring.category,
          impactedArea: SUB_TYPES.notExpiring.impactedArea,
          impact: SUB_TYPES.notExpiring.impact,
          recommendationSubType: SUB_TYPES.notExpiring.subType,
          recommendationSubTypeId: SUB_TYPES.notExpiring.subTypeId,
          recommendationDescription: SUB_TYPES.notExpiring.description,
          recommendationAction: SUB_TYPES.notExpiring.action,
        });
      }
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
