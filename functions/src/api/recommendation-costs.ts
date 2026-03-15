type RecommendationWithAdditionalInfo = {
  AdditionalInfo?: Record<string, unknown> | string | null;
};

const DEFAULT_CURRENCY = 'USD';

type RecommendationWithInstanceId = RecommendationWithAdditionalInfo & {
  InstanceId?: unknown;
};

export type RecommendationCostSummaryRow = {
  Category: string;
  Currency: string;
  Count: number;
  TotalMonthlySavings: number;
  TotalAnnualSavings: number;
  TotalCost30d: number;
};

export type RecommendationCostUsageRow = {
  InstanceId: string;
  Cost30d: number;
  Quantity30d: number;
  Currency: string;
  UnitOfMeasure: string;
  UnitOfMeasureCount: number;
  MeterCount: number;
};

function parseAdditionalInfo(value: RecommendationWithAdditionalInfo['AdditionalInfo']): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  return null;
}

function getFiniteNumber(value: unknown): number | null {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getFirstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const numericValue = getFiniteNumber(value);
    if (numericValue !== null) {
      return numericValue;
    }
  }

  return null;
}

function getFirstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getNormalizedAdditionalInfo(recommendation: RecommendationWithAdditionalInfo): Record<string, unknown> | null {
  const normalizedRecommendation = normalizeRecommendationCostFields(recommendation);
  return parseAdditionalInfo(normalizedRecommendation.AdditionalInfo);
}

export function getRecommendationCost30d(recommendation: RecommendationWithAdditionalInfo): number {
  const additionalInfo = getNormalizedAdditionalInfo(recommendation);
  return additionalInfo ? getFirstFiniteNumber([additionalInfo.cost30d]) ?? 0 : 0;
}

export function getRecommendationMonthlySavings(recommendation: RecommendationWithAdditionalInfo): number {
  const additionalInfo = getNormalizedAdditionalInfo(recommendation);
  return additionalInfo ? getFirstFiniteNumber([additionalInfo.savingsAmount]) ?? 0 : 0;
}

export function getRecommendationAnnualSavings(recommendation: RecommendationWithAdditionalInfo): number {
  const additionalInfo = getNormalizedAdditionalInfo(recommendation);
  return additionalInfo ? getFirstFiniteNumber([additionalInfo.annualSavingsAmount]) ?? 0 : 0;
}

export function getRecommendationCurrency(recommendation: RecommendationWithAdditionalInfo): string {
  const additionalInfo = getNormalizedAdditionalInfo(recommendation);
  return additionalInfo ? getFirstString([additionalInfo.costDataCurrency, additionalInfo.currency, additionalInfo.savingsCurrency, DEFAULT_CURRENCY]) ?? DEFAULT_CURRENCY : DEFAULT_CURRENCY;
}

export function enrichRecommendationsWithCostUsage<T extends RecommendationWithInstanceId>(
  recommendations: T[],
  costUsageRows: RecommendationCostUsageRow[],
): T[] {
  const costUsageByInstanceId = new Map(costUsageRows.map((row) => [row.InstanceId.trim().toLowerCase(), row]));

  return recommendations.map((recommendation) => {
    const normalizedRecommendation = normalizeRecommendationCostFields(recommendation);
    const normalizedInstanceId = typeof normalizedRecommendation.InstanceId === 'string' ? normalizedRecommendation.InstanceId.trim().toLowerCase() : '';
    const costUsage = normalizedInstanceId ? costUsageByInstanceId.get(normalizedInstanceId) : undefined;

    if (!costUsage) {
      return normalizedRecommendation;
    }

    const additionalInfo = parseAdditionalInfo(normalizedRecommendation.AdditionalInfo) ?? {};
    const existingCost30d = getFirstFiniteNumber([
      additionalInfo.cost30d,
      additionalInfo.diskCost30d,
      additionalInfo.computeCost30d,
      additionalInfo.monthlyCost,
    ]);
    const existingCurrency = getFirstString([additionalInfo.currency, additionalInfo.savingsCurrency]);

    return {
      ...normalizedRecommendation,
      AdditionalInfo: {
        ...additionalInfo,
        ...((existingCost30d === null || existingCost30d <= 0) && costUsage.Cost30d > 0 ? { cost30d: costUsage.Cost30d } : {}),
        ...(costUsage.Currency ? { costDataCurrency: costUsage.Currency } : {}),
        ...(existingCurrency ? {} : { currency: costUsage.Currency || DEFAULT_CURRENCY, savingsCurrency: costUsage.Currency || DEFAULT_CURRENCY }),
        ...(costUsage.Quantity30d > 0 ? { usageQuantity30d: costUsage.Quantity30d } : {}),
        ...(costUsage.UnitOfMeasureCount > 0 ? { usageUnitOfMeasureCount: costUsage.UnitOfMeasureCount } : {}),
        ...(costUsage.MeterCount > 0 ? { usageMeterCount: costUsage.MeterCount } : {}),
        ...(costUsage.UnitOfMeasureCount === 1 && costUsage.UnitOfMeasure ? { usageUnitOfMeasure: costUsage.UnitOfMeasure } : {}),
      },
    };
  });
}

export function aggregateRecommendationCostSummary<T extends RecommendationWithAdditionalInfo & { Category?: unknown }>(
  recommendations: T[],
): RecommendationCostSummaryRow[] {
  const grouped = new Map<string, RecommendationCostSummaryRow>();

  for (const recommendation of recommendations) {
    const category = typeof recommendation.Category === 'string' && recommendation.Category.trim() ? recommendation.Category : 'Unknown';
    const currency = getRecommendationCurrency(recommendation);
    const key = `${category}::${currency}`;
    const existing = grouped.get(key) ?? {
      Category: category,
      Currency: currency,
      Count: 0,
      TotalMonthlySavings: 0,
      TotalAnnualSavings: 0,
      TotalCost30d: 0,
    };

    existing.Count += 1;
    existing.TotalMonthlySavings += getRecommendationMonthlySavings(recommendation);
    existing.TotalAnnualSavings += getRecommendationAnnualSavings(recommendation);
    existing.TotalCost30d += getRecommendationCost30d(recommendation);
    grouped.set(key, existing);
  }

  return [...grouped.values()].sort((left, right) => right.TotalMonthlySavings - left.TotalMonthlySavings);
}

export function normalizeRecommendationCostFields<T extends RecommendationWithAdditionalInfo>(recommendation: T): T {
  const additionalInfo = parseAdditionalInfo(recommendation.AdditionalInfo);
  if (!additionalInfo) {
    return recommendation;
  }

  const cost30d = getFirstFiniteNumber([
    additionalInfo.cost30d,
    additionalInfo.diskCost30d,
    additionalInfo.computeCost30d,
    additionalInfo.monthlyCost,
  ]);
  const annualSavingsAmount = getFirstFiniteNumber([
    additionalInfo.annualSavingsAmount,
    additionalInfo.annualSavings,
    getFiniteNumber(additionalInfo.savingsAmount) !== null ? getFiniteNumber(additionalInfo.savingsAmount)! * 12 : null,
  ]);
  const savingsAmount = getFirstFiniteNumber([
    additionalInfo.savingsAmount,
    annualSavingsAmount !== null ? annualSavingsAmount / 12 : null,
  ]);
  const currency = getFirstString([additionalInfo.currency, additionalInfo.savingsCurrency, DEFAULT_CURRENCY]);

  return {
    ...recommendation,
    AdditionalInfo: {
      ...additionalInfo,
      ...(cost30d !== null ? { cost30d } : {}),
      ...(savingsAmount !== null ? { savingsAmount } : {}),
      ...(annualSavingsAmount !== null ? { annualSavingsAmount } : {}),
      ...(currency ? { currency, savingsCurrency: currency } : {}),
    },
  };
}