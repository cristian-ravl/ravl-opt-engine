// Centralized configuration service — reads from environment variables and provides
// a validated EngineContext to all collectors and recommenders.

import type { EngineContext } from '../providers/types.js';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key: string, fallback: string): string => process.env[key] ?? fallback;

const optionalInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} is not a valid integer: ${raw}`);
  }
  return parsed;
};

/**
 * Build an EngineContext from environment variables.
 * Call once at orchestrator startup and pass to all activities.
 */
export function buildContext(): EngineContext {
  return {
    cloudEnvironment: optional('OE_CLOUD_ENVIRONMENT', 'AzureCloud'),
    adxClusterUri: required('OE_ADX_CLUSTER_URI'),
    adxDatabase: optional('OE_ADX_DATABASE', 'OptimizationEngine'),
    storageAccountName: required('OE_STORAGE_ACCOUNT_NAME'),
    referenceRegion: optional('OE_REFERENCE_REGION', 'westeurope'),
    consumptionOffsetDays: optionalInt('OE_CONSUMPTION_OFFSET_DAYS', 2),
    consumptionCollectionDays: optionalInt('OE_CONSUMPTION_COLLECTION_DAYS', 30),
    longDeallocatedVmDays: optionalInt('OE_LONG_DEALLOCATED_VM_DAYS', 30),
    aadExpiringCredsDays: optionalInt('OE_AAD_EXPIRING_CREDS_DAYS', 30),
    aadMaxCredValidityDays: optionalInt('OE_AAD_MAX_CRED_VALIDITY_DAYS', 730),
    targetSubscriptions: parseList('OE_TARGET_SUBSCRIPTIONS'),
  };
}

function parseList(key: string): string[] {
  const raw = process.env[key];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether AWS collecting is enabled */
export function isAwsEnabled(): boolean {
  return optional('OE_AWS_ENABLED', 'false').toLowerCase() === 'true';
}

/** Whether GCP collecting is enabled */
export function isGcpEnabled(): boolean {
  return optional('OE_GCP_ENABLED', 'false').toLowerCase() === 'true';
}

/** Cron expression for the collection timer trigger */
export function collectionSchedule(): string {
  return optional('OE_COLLECTION_SCHEDULE', '0 0 2 * * *');
}

/** Cron expression for the metrics timer trigger */
export function metricsSchedule(): string {
  return optional('OE_METRICS_SCHEDULE', '0 0 * * * *');
}

/** Cron expression for the recommendation timer trigger */
export function recommendationSchedule(): string {
  return optional('OE_RECOMMENDATION_SCHEDULE', '0 0 4 * * 1');
}
