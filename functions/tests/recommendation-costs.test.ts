import { describe, expect, it } from 'vitest';
import { aggregateRecommendationCostSummary, enrichRecommendationsWithCostUsage, getRecommendationCost30d, getRecommendationCurrency, getRecommendationMonthlySavings, normalizeRecommendationCostFields } from '../src/api/recommendation-costs.js';

describe('recommendation cost normalization', () => {
  it('maps legacy cost and savings keys to the standard fields', () => {
    const recommendation = normalizeRecommendationCostFields({
      RecommendationId: 'rec-1',
      AdditionalInfo: {
        computeCost30d: 225,
        annualSavings: 2700,
        currency: 'EUR',
      },
    });

    expect(recommendation.AdditionalInfo).toMatchObject({
      cost30d: 225,
      savingsAmount: 225,
      annualSavingsAmount: 2700,
      currency: 'EUR',
      savingsCurrency: 'EUR',
    });
  });

  it('preserves modern fields when they are already present', () => {
    const recommendation = normalizeRecommendationCostFields({
      RecommendationId: 'rec-2',
      AdditionalInfo: {
        cost30d: 40,
        savingsAmount: 10,
        annualSavingsAmount: 120,
        currency: 'USD',
      },
    });

    expect(recommendation.AdditionalInfo).toMatchObject({
      cost30d: 40,
      savingsAmount: 10,
      annualSavingsAmount: 120,
      currency: 'USD',
    });
  });

  it('parses stringified additional info returned by ADX', () => {
    const recommendation = normalizeRecommendationCostFields({
      RecommendationId: 'rec-3',
      AdditionalInfo: JSON.stringify({
        monthlyCost: 88.5,
        annualSavings: 1062,
        savingsCurrency: 'GBP',
      }),
    });

    expect(recommendation.AdditionalInfo).toMatchObject({
      monthlyCost: 88.5,
      cost30d: 88.5,
      savingsAmount: 88.5,
      annualSavingsAmount: 1062,
      currency: 'GBP',
      savingsCurrency: 'GBP',
    });
  });

  it('aggregates cost summary from normalized recommendations', () => {
    const rows = [
      {
        Category: 'Cost',
        AdditionalInfo: JSON.stringify({ monthlyCost: 10, annualSavings: 120, savingsCurrency: 'USD' }),
      },
      {
        Category: 'Cost',
        AdditionalInfo: { cost30d: 5, savingsAmount: 2, annualSavingsAmount: 24, currency: 'USD' },
      },
    ];

    const summary = aggregateRecommendationCostSummary(rows);
    expect(summary).toEqual([
      {
        Category: 'Cost',
        Currency: 'USD',
        Count: 2,
        TotalMonthlySavings: 12,
        TotalAnnualSavings: 144,
        TotalCost30d: 15,
      },
    ]);

    expect(getRecommendationCost30d(rows[0])).toBe(10);
    expect(getRecommendationMonthlySavings(rows[0])).toBe(10);
  });

  it('enriches recommendations with cost and usage data from LatestCostData aggregates', () => {
    const [recommendation] = enrichRecommendationsWithCostUsage(
      [
        {
          InstanceId: '/subscriptions/sub/resourcegroups/rg/providers/microsoft.web/serverfarms/plan-a',
          AdditionalInfo: null,
        },
      ],
      [
        {
          InstanceId: '/subscriptions/sub/resourcegroups/rg/providers/microsoft.web/serverfarms/plan-a',
          Cost30d: 42.75,
          Quantity30d: 730,
          Currency: 'USD',
          UnitOfMeasure: 'Hours',
          UnitOfMeasureCount: 1,
          MeterCount: 1,
        },
      ],
    );

    expect(recommendation.AdditionalInfo).toMatchObject({
      cost30d: 42.75,
      costDataCurrency: 'USD',
      currency: 'USD',
      savingsCurrency: 'USD',
      usageQuantity30d: 730,
      usageUnitOfMeasure: 'Hours',
      usageUnitOfMeasureCount: 1,
      usageMeterCount: 1,
    });
  });

  it('prefers cost-data currency over generic currency fields', () => {
    expect(
      getRecommendationCurrency({
        AdditionalInfo: {
          currency: 'USD',
          savingsCurrency: 'USD',
          costDataCurrency: 'CAD',
        },
      }),
    ).toBe('CAD');
  });

  it('falls back to USD when no currency is available', () => {
    expect(
      getRecommendationCurrency({
        AdditionalInfo: {},
      }),
    ).toBe('USD');
  });
});