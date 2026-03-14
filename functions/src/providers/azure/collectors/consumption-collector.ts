// Collector: Azure consumption/cost details via Microsoft.Consumption usageDetails API.
// Collects a configurable date range (default 30 days) so recommenders have enough
// historical cost data. Re-ingested rows are deduplicated by the LatestCostData function.

import type { EngineContext, ICollector, CloudProvider } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll, resolveSubscriptionIds } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';

interface UsageDetailRecord {
  properties?: {
    date?: string;
    subscriptionId?: string;
    subscriptionGuid?: string;
    resourceGroup?: string;
    resourceId?: string;
    instanceName?: string;
    meterCategory?: string;
    meterSubCategory?: string;
    meterName?: string;
    unitOfMeasure?: string;
    quantity?: number;
    costInBillingCurrency?: number;
    cost?: number;
    billingCurrencyCode?: string;
    billingCurrency?: string;
    billingPeriodStartDate?: string;
    billingPeriodEndDate?: string;
    tags?: Record<string, string> | string;
  };
}

function toUtcDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseTags(raw: unknown): Record<string, string> {
  if (!raw) return {};

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, string>;
  }

  return {};
}

export class ConsumptionCostCollector implements ICollector {
  readonly id = 'azure-consumption';
  readonly name = 'Azure consumption cost details';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'consumptionexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();

    // Calculate the date range to collect.
    // End date: today minus offset (Azure Consumption data lags 24-72h)
    // Start date: end date minus collectionDays
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - ctx.consumptionOffsetDays);
    const startDate = addUtcDays(endDate, -ctx.consumptionCollectionDays);

    const usageStartStr = toUtcDateString(startDate);
    const usageEndExclusiveStr = toUtcDateString(addUtcDays(endDate, 1));

    const subscriptions = await resolveSubscriptionIds(ctx);

    console.log(`[consumption-collector] Querying usage from ${usageStartStr} to ${toUtcDateString(endDate)} (${ctx.consumptionCollectionDays} days, offset: ${ctx.consumptionOffsetDays})`);
    console.log(`[consumption-collector] Resolved ${subscriptions.length} subscription(s)`);

    let totalRecords = 0;

    for (const subscriptionId of subscriptions) {
      const params = new URLSearchParams({
        'api-version': '2021-10-01',
        metric: 'amortizedcost',
        $expand: 'properties/meterDetails,properties/additionalInfo',
        $filter: `properties/usageStart ge '${usageStartStr}' and properties/usageStart lt '${usageEndExclusiveStr}'`,
      });

      const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Consumption/usageDetails?${params.toString()}`;

      let rows: UsageDetailRecord[];
      try {
        rows = await armGetAll<UsageDetailRecord>(path);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[consumption-collector] Subscription ${subscriptionId}: API error — ${message}`);
        if (message.includes('401') || message.includes('403')) {
          console.error(`[consumption-collector] Subscription ${subscriptionId} may be missing Cost Management Reader role`);
        }
        continue;
      }

      if (rows.length === 0) {
        console.log(`[consumption-collector] Subscription ${subscriptionId}: 0 usage rows returned`);
        continue;
      }

      console.log(`[consumption-collector] Subscription ${subscriptionId}: ${rows.length} usage rows returned`);

      const mapped = rows.map((r) => {
        const props = r.properties ?? {};
        const instanceId = (props.resourceId ?? props.instanceName ?? '').toLowerCase();
        const billingStart = props.billingPeriodStartDate ?? usageStartStr;
        const billingEnd = props.billingPeriodEndDate ?? usageStartStr;
        const billingPeriod = `${billingStart}/${billingEnd}`;
        // Use the usage date from the API response; fall back to billing period start
        const usageDate = props.date ?? billingStart;

        return {
          timestamp,
          cloud: 'Azure',
          subscriptionId: props.subscriptionId ?? props.subscriptionGuid ?? subscriptionId,
          resourceGroup: (props.resourceGroup ?? '').toLowerCase(),
          instanceId,
          meterCategory: props.meterCategory ?? '',
          meterSubCategory: props.meterSubCategory ?? '',
          meterName: props.meterName ?? '',
          unitOfMeasure: props.unitOfMeasure ?? '',
          quantity: Number(props.quantity ?? 0),
          cost: Number(props.costInBillingCurrency ?? props.cost ?? 0),
          currency: props.billingCurrencyCode ?? props.billingCurrency ?? 'USD',
          billingPeriod,
          tags: parseTags(props.tags),
          usageDate,
        };
      });

      const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}-${subscriptionId}.ndjson`;
      await uploadJsonBlob(ctx, this.targetSuffix, blobName, mapped);
      await ingestCollectorRows(ctx, this.id, this.targetSuffix, mapped);
      totalRecords += mapped.length;
    }

    console.log(`[consumption-collector] Total records ingested across all subscriptions: ${totalRecords}`);
    return totalRecords;
  }
}
