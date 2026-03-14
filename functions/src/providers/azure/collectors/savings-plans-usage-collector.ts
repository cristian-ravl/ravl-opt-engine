import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';
import { resolveBillingScopeContext } from './benefits-helpers.js';

type SavingsPlanUsage = {
  id?: string;
  sku?: {
    name?: string;
  };
  properties?: {
    displayName?: string;
    term?: string;
    displayProvisioningState?: string;
    userFriendlyAppliedScopeType?: string;
    renew?: string;
    purchaseDateTime?: string;
    purchaseDate?: string;
    benefitStartTime?: string;
    expiryDateTime?: string;
    expiryDate?: string;
    effectiveDateTime?: string;
    billingScopeId?: string;
    billingAccountId?: string;
    billingProfileId?: string;
    billingPlan?: string;
    commitment?: {
      grain?: string;
      currencyCode?: string;
      amount?: number;
    };
    utilization?: {
      trend?: string;
      aggregates?: Array<{
        grain?: number;
        value?: number;
      }>;
    };
  };
};

type SavingsPlanUtilizationAggregate = {
  grain?: number;
  value?: number;
};

function aggregateValue(aggregates: SavingsPlanUtilizationAggregate[] | undefined, grain: number): number {
  return Number(aggregates?.find((aggregate) => aggregate.grain === grain)?.value ?? 0);
}

function toIsoOrEmpty(value: string | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

export class SavingsPlansUsageCollector implements ICollector {
  readonly id = 'azure-savings-plans-usage';
  readonly name = 'Azure savings plans usage';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'savingsplansexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const scopeContext = await resolveBillingScopeContext();
    const scope = scopeContext.isMca ? `/providers/Microsoft.Billing/billingaccounts/${scopeContext.billingAccountId}` : scopeContext.scope;
    const filter = scopeContext.isMca
      ? `&$filter=(properties/billingProfileId eq '/providers/Microsoft.Billing/billingAccounts/${scopeContext.billingAccountId}/billingProfiles/${scopeContext.billingProfileId}')`
      : '';
    const apiVersion = scopeContext.isMca ? '2022-10-01-privatepreview' : '2020-12-15-privatepreview';
    const path = `${scope}/savingsPlans?api-version=${apiVersion}&refreshsummary=true&take=100${filter}`;

    const usages = await armGetAll<SavingsPlanUsage>(path);
    const rows = usages.map((usage) => {
      const properties = usage.properties ?? {};
      const utilization = properties.utilization;

      return {
        timestamp,
        cloud: 'Azure',
        tenantId: scopeContext.tenantId,
        scope,
        savingsPlanResourceId: String(usage.id ?? ''),
        savingsPlanOrderId: String(usage.id ?? '').split('/savingsPlans/')[0] ?? '',
        savingsPlanId: String(usage.id ?? '').split('/').at(-1) ?? '',
        displayName: String(properties.displayName ?? ''),
        skuName: String(usage.sku?.name ?? ''),
        term: String(properties.term ?? ''),
        provisioningState: String(properties.displayProvisioningState ?? ''),
        appliedScopeType: String(properties.userFriendlyAppliedScopeType ?? ''),
        renewState: String(properties.renew ?? ''),
        purchaseDate: toIsoOrEmpty(properties.purchaseDateTime ?? properties.purchaseDate),
        benefitStart: toIsoOrEmpty(properties.benefitStartTime),
        expiryDate: toIsoOrEmpty(properties.expiryDateTime ?? properties.expiryDate),
        effectiveDate: toIsoOrEmpty(properties.effectiveDateTime),
        billingScopeId: String(properties.billingScopeId ?? ''),
        billingAccountId: String(properties.billingAccountId ?? scopeContext.billingAccountId),
        billingProfileId: String(properties.billingProfileId ?? scopeContext.billingProfileId),
        billingPlan: String(properties.billingPlan ?? ''),
        commitmentGrain: String(properties.commitment?.grain ?? ''),
        commitmentCurrencyCode: String(properties.commitment?.currencyCode ?? ''),
        commitmentAmount: Number(properties.commitment?.amount ?? 0),
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
