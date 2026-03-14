import { buildRecommenderCompatibilityKql } from '../utils/recommender-metadata.js';

const LATEST_RECOMMENDATION_RUN_GAP = '30m';

interface RecommendationQueryFilters {
  cloud?: string | null;
  category?: string | null;
  impact?: string | null;
  subType?: string | null;
  recommenderId?: string | null;
  subscriptionId?: string | null;
  resourceGroup?: string | null;
}

interface RecommendationListQueryOptions {
  filters: RecommendationQueryFilters;
  includeSuppressed: boolean;
  offset: number;
  limit: number;
}

interface RecommendationCountQueryOptions {
  filters: RecommendationQueryFilters;
  includeSuppressed: boolean;
}

function buildLatestRecommendationsBaseKql(): string {
  return `
    let recommendationRunGap = ${LATEST_RECOMMENDATION_RUN_GAP};
    let latestRunStart = toscalar(
      Recommendations
      | summarize by GeneratedDate
      | order by GeneratedDate desc
      | serialize
      | extend PreviousGeneratedDate = next(GeneratedDate)
      | extend GapToPreviousGeneratedDate = iff(
          isnull(PreviousGeneratedDate),
          recommendationRunGap + 1m,
          GeneratedDate - PreviousGeneratedDate
        )
      | where GapToPreviousGeneratedDate > recommendationRunGap
      | summarize max(GeneratedDate)
    );
    Recommendations
    | where isnotnull(latestRunStart)
    | where GeneratedDate >= latestRunStart
  `;
}

function buildRecommendationFiltersKql(filters: RecommendationQueryFilters): string {
  const clauses: string[] = [];

  if (filters.cloud) clauses.push(`Cloud == "${escapeKql(filters.cloud)}"`);
  if (filters.category) clauses.push(`Category == "${escapeKql(filters.category)}"`);
  if (filters.impact) clauses.push(`Impact == "${escapeKql(filters.impact)}"`);
  if (filters.subType) clauses.push(`RecommendationSubType == "${escapeKql(filters.subType)}"`);
  if (filters.recommenderId) clauses.push(`RecommenderId == "${escapeKql(filters.recommenderId)}"`);
  if (filters.subscriptionId) clauses.push(`SubscriptionId == "${escapeKql(filters.subscriptionId)}"`);
  if (filters.resourceGroup) clauses.push(`ResourceGroup =~ "${escapeKql(filters.resourceGroup)}"`);

  return clauses.length > 0 ? `| where ${clauses.join(' and ')}` : '';
}

function buildRecommendationSuppressionJoinKql(includeSuppressed: boolean): string {
  if (includeSuppressed) return '';

  return `| join kind=leftanti (
            Suppressions
            | where IsEnabled == true
            | where FilterType in ("Dismiss", "Exclude") or (FilterType == "Snooze" and FilterEndDate > now())
            | where isempty(InstanceId) or InstanceId == ""
            | project RecommendationSubTypeId
          ) on RecommendationSubTypeId
          | join kind=leftanti (
            Suppressions
            | where IsEnabled == true
            | where FilterType in ("Dismiss", "Exclude") or (FilterType == "Snooze" and FilterEndDate > now())
            | where isnotempty(InstanceId)
            | project RecommendationSubTypeId, InstanceId
          ) on RecommendationSubTypeId, InstanceId`;
}

export function buildRecommendationsListKql(options: RecommendationListQueryOptions): string {
  return `
    ${buildLatestRecommendationsBaseKql()}
    ${buildRecommenderCompatibilityKql()}
    ${buildRecommendationFiltersKql(options.filters)}
    ${buildRecommendationSuppressionJoinKql(options.includeSuppressed)}
    | extend
        ImpactSort = case(Impact == "High", 0, Impact == "Medium", 1, 2),
        MonthlySavings = todouble(coalesce(AdditionalInfo.savingsAmount, 0))
    | order by ImpactSort asc, FitScore desc, MonthlySavings desc, GeneratedDate desc
    | serialize RowNum = row_number()
    | where RowNum > ${options.offset}
    | project-away ImpactSort, MonthlySavings
    | take ${options.limit}
  `;
}

export function buildRecommendationsCountKql(options: RecommendationCountQueryOptions): string {
  return `
    ${buildLatestRecommendationsBaseKql()}
    ${buildRecommenderCompatibilityKql()}
    ${buildRecommendationFiltersKql(options.filters)}
    ${buildRecommendationSuppressionJoinKql(options.includeSuppressed)}
    | count
  `;
}

export function buildRecommendationsSummaryKql(): string {
  return `
    ${buildLatestRecommendationsBaseKql()}
    ${buildRecommenderCompatibilityKql()}
    ${buildRecommendationSuppressionJoinKql(false)}
    | summarize Count = count() by Category, Impact, Cloud, RecommendationSubType, RecommenderId, RecommenderName
    | order by Count desc
  `;
}

export function buildCostSummaryKql(): string {
  return `
    ${buildLatestRecommendationsBaseKql()}
    ${buildRecommenderCompatibilityKql()}
    ${buildRecommendationSuppressionJoinKql(false)}
    | extend MonthlySavings = todouble(coalesce(AdditionalInfo.savingsAmount, 0))
    | extend AnnualSavings = todouble(coalesce(AdditionalInfo.annualSavingsAmount, 0))
    | extend Cost30d = todouble(coalesce(AdditionalInfo.cost30d, AdditionalInfo.diskCost30d, 0))
    | extend Currency = tostring(coalesce(AdditionalInfo.currency, AdditionalInfo.savingsCurrency, "USD"))
    | summarize
        Count = count(),
        TotalMonthlySavings = sum(MonthlySavings),
        TotalAnnualSavings = sum(AnnualSavings),
        TotalCost30d = sum(Cost30d)
      by Category, Currency
    | order by TotalMonthlySavings desc
  `;
}

/** Escape for safe KQL string interpolation */
export function escapeKql(value: string): string {
  return value
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[;\n\r|]/g, '');
}
