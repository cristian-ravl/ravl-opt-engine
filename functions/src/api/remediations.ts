import { app, type HttpResponseInit } from '@azure/functions';
import { buildContext } from '../config/index.js';
import { AzureProvider } from '../providers/azure/index.js';
import type { Recommendation } from '../providers/types.js';
import { query } from '../utils/adx-client.js';
import { escapeKql } from './recommendations-query.js';

type RecommendationRow = {
  RecommendationId: string;
  GeneratedDate: string;
  Cloud: string;
  Category: Recommendation['category'];
  ImpactedArea: string;
  Impact: Recommendation['impact'];
  RecommendationType: string;
  RecommendationSubType: string;
  RecommendationSubTypeId: string;
  RecommendationDescription: string;
  RecommendationAction: string;
  InstanceId: string;
  InstanceName: string;
  AdditionalInfo: Record<string, unknown>;
  ResourceGroup: string;
  SubscriptionId: string;
  SubscriptionName: string;
  TenantId: string;
  FitScore: number;
  Tags: Record<string, string>;
  DetailsUrl: string;
};

function toRecommendation(row: RecommendationRow): Recommendation {
  return {
    recommendationId: row.RecommendationId,
    generatedDate: row.GeneratedDate,
    cloud: row.Cloud as Recommendation['cloud'],
    category: row.Category,
    impactedArea: row.ImpactedArea,
    impact: row.Impact,
    recommendationType: row.RecommendationType,
    recommendationSubType: row.RecommendationSubType,
    recommendationSubTypeId: row.RecommendationSubTypeId,
    recommendationDescription: row.RecommendationDescription,
    recommendationAction: row.RecommendationAction,
    instanceId: row.InstanceId,
    instanceName: row.InstanceName,
    resourceGroup: row.ResourceGroup,
    subscriptionId: row.SubscriptionId,
    subscriptionName: row.SubscriptionName,
    tenantId: row.TenantId,
    fitScore: row.FitScore,
    tags: row.Tags ?? {},
    detailsUrl: row.DetailsUrl,
    additionalInfo: row.AdditionalInfo ?? {},
  };
}

app.http('runRemediation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'remediations/{recommendationId}',
  handler: async (req): Promise<HttpResponseInit> => {
    const recommendationId = req.params.recommendationId;
    if (!recommendationId) {
      return { status: 400, jsonBody: { error: 'recommendationId is required' } };
    }

    const ctx = buildContext();
    const provider = new AzureProvider();
    const body = (await req.json().catch(() => ({}))) as { simulate?: boolean; unattachedDiskAction?: string };

    const kql = `
      Recommendations
      | where RecommendationId == guid('${escapeKql(recommendationId)}')
      | top 1 by GeneratedDate desc
    `;
    const rows = await query<RecommendationRow>(ctx, kql);
    const row = rows[0];
    if (!row) {
      return { status: 404, jsonBody: { error: 'Recommendation not found' } };
    }

    const recommendation = toRecommendation(row);
    const remediator = provider.remediators.find((candidate) =>
      candidate.handlesSubTypeIds.includes(recommendation.recommendationSubTypeId),
    );
    if (!remediator) {
      return { status: 409, jsonBody: { error: 'No remediator is registered for this recommendation subtype' } };
    }

    const previousSimulate = process.env.OE_REMEDIATION_SIMULATE;
    const previousDiskAction = process.env.OE_REMEDIATE_UNATTACHED_DISKS_ACTION;

    if (typeof body.simulate === 'boolean') {
      process.env.OE_REMEDIATION_SIMULATE = String(body.simulate);
    }

    if (typeof body.unattachedDiskAction === 'string' && body.unattachedDiskAction.trim()) {
      process.env.OE_REMEDIATE_UNATTACHED_DISKS_ACTION = body.unattachedDiskAction.trim();
    }

    try {
      const result = await remediator.remediate(recommendation, ctx);
      return { status: 200, jsonBody: result };
    } finally {
      if (previousSimulate === undefined) {
        delete process.env.OE_REMEDIATION_SIMULATE;
      } else {
        process.env.OE_REMEDIATION_SIMULATE = previousSimulate;
      }

      if (previousDiskAction === undefined) {
        delete process.env.OE_REMEDIATE_UNATTACHED_DISKS_ACTION;
      } else {
        process.env.OE_REMEDIATE_UNATTACHED_DISKS_ACTION = previousDiskAction;
      }
    }
  },
});
