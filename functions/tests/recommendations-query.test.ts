import { describe, expect, it } from 'vitest';
import { buildRecommendationsCountKql, buildRecommendationsListKql, buildRecommendationsSummaryKql } from '../src/api/recommendations-query.js';

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
    expect(kql).toContain('SubscriptionId == "sub-123"');
    expect(kql).toContain('ResourceGroup =~ "rg-app"');
    expect(kql).toContain('| join kind=leftanti (');
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
    expect(countKql).toContain('| count');
    expect(countKql).not.toContain('Suppressions');

    expect(summaryKql).toContain('where GeneratedDate >= latestRunStart');
    expect(summaryKql).toContain('| summarize Count = count() by Category, Impact, Cloud, RecommendationSubType');
    expect(summaryKql).toContain('Suppressions');
  });
});
