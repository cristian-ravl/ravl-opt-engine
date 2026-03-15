import { describe, expect, it } from 'vitest';
import { buildRecommendationCostUsageLookupKql, buildRecommendationsCountKql, buildRecommendationsListKql, buildRecommendationsSummaryKql } from '../src/api/recommendations-query.js';

describe('recommendations query builders', () => {
  it('clusters the latest recommendation run instead of filtering to one exact timestamp', () => {
    const kql = buildRecommendationsListKql({
      filters: {},
      includeSuppressed: false,
      offset: 0,
      limit: 50,
    });

    expect(kql).toContain('let recommendationRunGap = 30m;');
    expect(kql).toContain('extend PreviousGeneratedDate = next(GeneratedDate)');
    expect(kql).toContain('where GapToPreviousGeneratedDate > recommendationRunGap');
    expect(kql).toContain('where GeneratedDate >= latestRunStart');
    expect(kql).not.toContain('GeneratedDate == toscalar(latestRun)');
  });

  it('applies filters, suppression handling, and pagination to the list query', () => {
    const kql = buildRecommendationsListKql({
      filters: {
        cloud: 'Azure',
        category: 'Cost',
        impact: 'High',
        subType: 'Idle VM',
        recommenderId: 'stopped-vms',
        subscriptionId: 'sub-123',
        resourceGroup: 'rg-app',
      },
      includeSuppressed: false,
      offset: 50,
      limit: 25,
    });

    expect(kql).toContain('Cloud == "Azure"');
    expect(kql).toContain('Category == "Cost"');
    expect(kql).toContain('Impact == "High"');
    expect(kql).toContain('RecommendationSubType == "Idle VM"');
    expect(kql).toContain('RecommenderId == "stopped-vms"');
    expect(kql).toContain('SubscriptionId == "sub-123"');
    expect(kql).toContain('ResourceGroup =~ "rg-app"');
    expect(kql).toContain('| join kind=leftanti (');
    expect(kql).toContain('SuppressionJoinInstanceId = tolower(InstanceId)');
    expect(kql).toContain('LegacyRecommenderId = case(');
    expect(kql).toContain('RecommendationSubType startswith "Advisor"');
    expect(kql).toContain('ImpactSort = case(Impact == "High", 0, Impact == "Medium", 1, 2)');
    expect(kql).toContain('| order by ImpactSort asc, FitScore desc, GeneratedDate desc');
    expect(kql).toContain('| where RowNum > 50');
    expect(kql).toContain('| take 25');
  });

  it('reuses the same latest-run window for count and summary queries', () => {
    const countKql = buildRecommendationsCountKql({
      filters: {},
      includeSuppressed: true,
    });
    const summaryKql = buildRecommendationsSummaryKql();

    expect(countKql).toContain('where GeneratedDate >= latestRunStart');
    expect(countKql).toContain('RecommenderId = iff(isempty(tostring(column_ifexists("RecommenderId", "")))');
    expect(countKql).toContain('| count');
    expect(countKql).not.toContain('Suppressions');

    expect(summaryKql).toContain('where GeneratedDate >= latestRunStart');
    expect(summaryKql).toContain('| summarize Count = count() by Category, Impact, Cloud, RecommendationSubType, RecommenderId, RecommenderName');
    expect(summaryKql).toContain('Suppressions');
  });

  it('builds a cost and usage lookup for specific instance ids', () => {
    const kql = buildRecommendationCostUsageLookupKql([
      '/subscriptions/sub-1/resourcegroups/rg-1/providers/microsoft.compute/virtualmachines/vm-1',
    ]);

    expect(kql).toContain('LatestCostData');
    expect(kql).toContain('NormalizedInstanceId = tolower(InstanceId)');
    expect(kql).toContain('Quantity30d = sum(Quantity)');
    expect(kql).toContain('UnitOfMeasureCount = dcount(UnitOfMeasure)');
    expect(kql).toContain('MeterCount = dcount(MeterName)');
    expect(kql).toContain('by InstanceId = NormalizedInstanceId');
  });
});
