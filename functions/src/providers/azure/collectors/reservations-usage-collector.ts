import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';
import { resolveBillingScopeContext, targetUsageDate } from './benefits-helpers.js';

type ReservationDetail = {
  id?: string;
  location?: string;
  properties?: {
    displayName?: string;
    reservedResourceType?: string;
    userFriendlyAppliedScopeType?: string;
    term?: string;
    displayProvisioningState?: string;
    userFriendlyRenewState?: string;
    purchaseDate?: string;
    expiryDate?: string;
    archived?: boolean;
    utilization?: {
      trend?: string;
      aggregates?: Array<{
        grain?: number;
        value?: number;
      }>;
    };
  };
};

type ReservationUsage = {
  properties?: {
    reservationOrderId?: string;
    reservationId?: string;
    skuName?: string;
    reservedHours?: number;
    usedHours?: number;
    usageDate?: string;
    minUtilizationPercentage?: number;
    avgUtilizationPercentage?: number;
    maxUtilizationPercentage?: number;
    purchasedQuantity?: number;
    remainingQuantity?: number;
    totalReservedQuantity?: number;
    usedQuantity?: number;
    utilizedPercentage?: number;
  };
};

type ReservationUtilizationAggregate = {
  grain?: number;
  value?: number;
};

function aggregateValue(aggregates: ReservationUtilizationAggregate[] | undefined, grain: number): number {
  return Number(aggregates?.find((aggregate) => aggregate.grain === grain)?.value ?? 0);
}

export class ReservationsUsageCollector implements ICollector {
  readonly id = 'azure-reservations-usage';
  readonly name = 'Azure reservations usage';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'reservationsexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const usageDate = targetUsageDate(ctx.consumptionOffsetDays);
    const scopeContext = await resolveBillingScopeContext();

    const reservationDetails = await armGetAll<ReservationDetail>(`${scopeContext.scope}/reservations?api-version=2020-05-01&refreshSummary=true`);
    const detailById = new Map(reservationDetails.map((detail) => [String(detail.id ?? '').toLowerCase(), detail]));

    const summariesPath = scopeContext.isMca
      ? `${scopeContext.scope}/providers/Microsoft.Consumption/reservationSummaries?api-version=2023-05-01&startDate=${usageDate}&endDate=${usageDate}&grain=daily`
      : `${scopeContext.scope}/providers/Microsoft.Consumption/reservationSummaries?api-version=2023-05-01&$filter=properties/UsageDate ge ${usageDate} and properties/UsageDate le ${usageDate}&grain=daily`;
    const reservationUsage = await armGetAll<ReservationUsage>(summariesPath);

    const rows = reservationUsage.map((usage) => {
      const usageProps = usage.properties ?? {};
      const reservationResourceId = `/providers/microsoft.capacity/reservationorders/${usageProps.reservationOrderId}/reservations/${usageProps.reservationId}`.toLowerCase();
      const detail = detailById.get(reservationResourceId);
      const utilization = detail?.properties?.utilization;

      return {
        timestamp,
        cloud: 'Azure',
        tenantId: scopeContext.tenantId,
        scope: scopeContext.scope,
        reservationResourceId,
        reservationOrderId: String(usageProps.reservationOrderId ?? ''),
        reservationId: String(usageProps.reservationId ?? ''),
        displayName: String(detail?.properties?.displayName ?? ''),
        skuName: String(usageProps.skuName ?? ''),
        location: String(detail?.location ?? ''),
        resourceType: String(detail?.properties?.reservedResourceType ?? ''),
        appliedScopeType: String(detail?.properties?.userFriendlyAppliedScopeType ?? ''),
        term: String(detail?.properties?.term ?? ''),
        provisioningState: String(detail?.properties?.displayProvisioningState ?? ''),
        renewState: String(detail?.properties?.userFriendlyRenewState ?? ''),
        purchaseDate: String(detail?.properties?.purchaseDate ?? ''),
        expiryDate: String(detail?.properties?.expiryDate ?? ''),
        archived: Boolean(detail?.properties?.archived ?? false),
        reservedHours: Number(usageProps.reservedHours ?? 0),
        usedHours: Number(usageProps.usedHours ?? 0),
        usageDate: String(usageProps.usageDate ?? usageDate),
        minUtilPercentage: Number(usageProps.minUtilizationPercentage ?? 0),
        avgUtilPercentage: Number(usageProps.avgUtilizationPercentage ?? 0),
        maxUtilPercentage: Number(usageProps.maxUtilizationPercentage ?? 0),
        purchasedQuantity: Number(usageProps.purchasedQuantity ?? 0),
        remainingQuantity: Number(usageProps.remainingQuantity ?? 0),
        totalReservedQuantity: Number(usageProps.totalReservedQuantity ?? 0),
        usedQuantity: Number(usageProps.usedQuantity ?? 0),
        utilizedPercentage: Number(usageProps.utilizedPercentage ?? 0),
        utilTrend: String(utilization?.trend ?? ''),
        util1Days: aggregateValue(utilization?.aggregates, 1),
        util7Days: aggregateValue(utilization?.aggregates, 7),
        util30Days: aggregateValue(utilization?.aggregates, 30),
      };
    });

    if (rows.length === 0) return 0;

    const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}.ndjson`;
    await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
    await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
    return rows.length;
  }
}
