import { AzureProvider } from '../providers/azure/index.js';

type RecommenderMetadata = {
  recommenderId: string;
  recommenderName: string;
};

type RecommendationIdentity = Partial<{
  recommenderId: string | null;
  recommenderName: string | null;
  recommendationSubType: string | null;
  recommendationSubTypeId: string | null;
}>;

type LegacyKqlRule = {
  condition: string;
  recommenderId: string;
};

const azureProvider = new AzureProvider();
const recommenderNameById = new Map(azureProvider.recommenders.map((recommender) => [recommender.id, recommender.name]));
const recommenderBySubTypeId = new Map<string, RecommenderMetadata>();
const recommenderBySubType = new Map<string, RecommenderMetadata>();

for (const recommender of azureProvider.recommenders) {
  const metadata = {
    recommenderId: recommender.id,
    recommenderName: recommender.name,
  } satisfies RecommenderMetadata;

  for (const subType of recommender.subTypes) {
    recommenderBySubTypeId.set(subType.subTypeId.toLowerCase(), metadata);
    recommenderBySubType.set(subType.subType.toLowerCase(), metadata);
  }
}

const legacyKqlRules: LegacyKqlRule[] = [
  ...azureProvider.recommenders.flatMap((recommender) =>
    recommender.subTypes.flatMap((subType) => [
      {
        condition: `tostring(RecommendationSubTypeId) == "${escapeKqlString(subType.subTypeId)}"`,
        recommenderId: recommender.id,
      },
      {
        condition: `RecommendationSubType =~ "${escapeKqlString(subType.subType)}"`,
        recommenderId: recommender.id,
      },
    ]),
  ),
  {
    condition: 'RecommendationSubType startswith "Advisor"',
    recommenderId: 'advisor-asis',
  },
];

export function deriveRecommenderMetadata(identity: RecommendationIdentity): RecommenderMetadata | null {
  const recommenderId = identity.recommenderId?.trim();
  const recommenderName = identity.recommenderName?.trim();

  if (recommenderId && recommenderName) {
    return { recommenderId, recommenderName };
  }

  if (recommenderId) {
    return {
      recommenderId,
      recommenderName: recommenderNameById.get(recommenderId) ?? recommenderName ?? recommenderId,
    };
  }

  if (recommenderName) {
    return { recommenderId: '', recommenderName };
  }

  const subTypeId = identity.recommendationSubTypeId?.trim().toLowerCase();
  if (subTypeId) {
    const metadata = recommenderBySubTypeId.get(subTypeId);
    if (metadata) return metadata;
  }

  const subType = identity.recommendationSubType?.trim();
  if (!subType) return null;

  const exactMatch = recommenderBySubType.get(subType.toLowerCase());
  if (exactMatch) return exactMatch;

  if (subType.startsWith('Advisor')) {
    const recommenderName = recommenderNameById.get('advisor-asis');
    return recommenderName
      ? {
          recommenderId: 'advisor-asis',
          recommenderName,
        }
      : null;
  }

  return null;
}

export function buildRecommenderCompatibilityKql(): string {
  const recommenderIdFallback = buildLegacyCaseExpression((rule) => rule.recommenderId);
  const recommenderNameFallback = buildLegacyCaseExpression((rule) => recommenderNameById.get(rule.recommenderId) ?? rule.recommenderId);

  return `
    | extend
        LegacyRecommenderId = ${recommenderIdFallback},
        LegacyRecommenderName = ${recommenderNameFallback}
    | extend
        RecommenderId = iff(isempty(tostring(column_ifexists("RecommenderId", ""))), LegacyRecommenderId, tostring(column_ifexists("RecommenderId", ""))),
        RecommenderName = iff(isempty(tostring(column_ifexists("RecommenderName", ""))), LegacyRecommenderName, tostring(column_ifexists("RecommenderName", "")))
    | project-away LegacyRecommenderId, LegacyRecommenderName
  `;
}

function buildLegacyCaseExpression(selectValue: (rule: LegacyKqlRule) => string): string {
  const clauses = legacyKqlRules.map((rule) => `${rule.condition}, "${escapeKqlString(selectValue(rule))}"`);
  return clauses.length > 0 ? `case(${clauses.join(', ')}, "")` : '""';
}

function escapeKqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}
