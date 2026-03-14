import { describe, expect, it } from 'vitest';
import { buildRecommenderCompatibilityKql, deriveRecommenderMetadata } from '../src/utils/recommender-metadata.js';

describe('recommender metadata compatibility', () => {
  it('derives metadata from exact legacy subtype ids', () => {
    expect(
      deriveRecommenderMetadata({
        recommendationSubTypeId: '110fea55-a9c3-480d-8248-116f61e139a8',
      }),
    ).toEqual({
      recommenderId: 'stopped-vms',
      recommenderName: 'Stopped VMs',
    });
  });

  it('derives metadata from legacy Advisor subtype names', () => {
    expect(
      deriveRecommenderMetadata({
        recommendationSubType: 'AdvisorHighAvailability',
      }),
    ).toEqual({
      recommenderId: 'advisor-asis',
      recommenderName: 'Advisor as-is recommendations',
    });
  });

  it('builds KQL compatibility rules for legacy rows', () => {
    const kql = buildRecommenderCompatibilityKql();

    expect(kql).toContain('LegacyRecommenderId = case(');
    expect(kql).toContain('RecommendationSubType =~ "StoppedVms"');
    expect(kql).toContain('RecommendationSubType startswith "Advisor"');
    expect(kql).toContain('RecommenderName = iff(isempty(tostring(column_ifexists("RecommenderName", "")))');
  });
});
