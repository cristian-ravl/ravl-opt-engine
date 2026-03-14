import { resolveTenantId } from '../../../utils/arm-client.js';

const MCA_BILLING_ACCOUNT_ID_REGEX = /([A-Za-z0-9]+(-[A-Za-z0-9]+)+):([A-Za-z0-9]+(-[A-Za-z0-9]+)+)_[0-9]{4}-[0-9]{2}-[0-9]{2}/;

export type BillingScopeContext = {
  scope: string;
  billingAccountId: string;
  billingProfileId: string;
  tenantId: string;
  isMca: boolean;
};

function env(name: string): string {
  return process.env[name] ?? '';
}

export async function resolveBillingScopeContext(): Promise<BillingScopeContext> {
  const explicitScope = env('OE_BILLING_SCOPE');
  const billingAccountId = env('OE_BILLING_ACCOUNT_ID');
  const billingProfileId = env('OE_BILLING_PROFILE_ID');
  const tenantId = await resolveTenantId();

  if (explicitScope) {
    return {
      scope: explicitScope,
      billingAccountId,
      billingProfileId,
      tenantId,
      isMca: MCA_BILLING_ACCOUNT_ID_REGEX.test(billingAccountId),
    };
  }

  if (!billingAccountId) {
    throw new Error('Missing billing scope configuration. Set OE_BILLING_SCOPE or OE_BILLING_ACCOUNT_ID.');
  }

  const isMca = MCA_BILLING_ACCOUNT_ID_REGEX.test(billingAccountId);
  if (isMca) {
    if (!billingProfileId) {
      throw new Error('Billing profile configuration is required for MCA scopes. Set OE_BILLING_PROFILE_ID.');
    }

    return {
      scope: `/providers/Microsoft.Billing/billingaccounts/${billingAccountId}/billingProfiles/${billingProfileId}`,
      billingAccountId,
      billingProfileId,
      tenantId,
      isMca,
    };
  }

  return {
    scope: `/providers/Microsoft.Billing/billingaccounts/${billingAccountId}`,
    billingAccountId,
    billingProfileId,
    tenantId,
    isMca,
  };
}

export function targetUsageDate(consumptionOffsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(consumptionOffsetDays, 0));
  return date.toISOString().slice(0, 10);
}
