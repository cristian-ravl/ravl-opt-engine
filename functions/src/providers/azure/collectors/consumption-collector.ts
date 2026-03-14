// Collector: Azure consumption/cost details via Microsoft.Consumption usageDetails API.

import type { EngineContext, ICollector, CloudProvider } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll, resolveSubscriptionIds } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';

interface UsageDetailRecord {
  properties?: {
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
    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() - ctx.consumptionOffsetDays);
    const usageDate = toUtcDateString(targetDate);
    const usageEndExclusive = toUtcDateString(addUtcDays(targetDate, 1));
    const subscriptions = await resolveSubscriptionIds(ctx);

    let totalRecords = 0;

    for (const subscriptionId of subscriptions) {
      const params = new URLSearchParams({
        'api-version': '2021-10-01',
        metric: 'amortizedcost',
        $expand: 'properties/meterDetails,properties/additionalInfo',
        $filter: `properties/usageStart ge '${usageDate}' and properties/usageStart lt '${usageEndExclusive}'`,
      });

      const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Consumption/usageDetails?${params.toString()}`;
      const rows = await armGetAll<UsageDetailRecord>(path);
      if (rows.length === 0) continue;

      const mapped = rows.map((r) => {
        const props = r.properties ?? {};
        const instanceId = (props.resourceId ?? props.instanceName ?? '').toLowerCase();
        const billingStart = props.billingPeriodStartDate ?? usageDate;
        const billingEnd = props.billingPeriodEndDate ?? usageDate;
        const billingPeriod = `${billingStart}/${billingEnd}`;

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
        };
      });

      const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}-${subscriptionId}.ndjson`;
      await uploadJsonBlob(ctx, this.targetSuffix, blobName, mapped);
      await ingestCollectorRows(ctx, this.id, this.targetSuffix, mapped);
      totalRecords += mapped.length;
    }

    return totalRecords;
  }
}
