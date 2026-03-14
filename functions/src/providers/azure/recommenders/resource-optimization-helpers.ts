import type { Recommendation } from '../../types.js';

export type PriceSheetRow = {
  MeterName: string;
  MeterSubCategory: string;
  MeterCategory: string;
  MeterRegion: string;
  UnitPrice: number;
  UnitOfMeasure: string;
  CurrencyCode: string;
};

const PRICE_SHEET_REGION_BY_REFERENCE_REGION: Record<string, string> = {
  australiasoutheast: 'AU Southeast',
  canadacentral: 'CA Central',
  centralus: 'US Central',
  eastasia: 'AP East',
  eastus: 'US East',
  eastus2: 'US East 2',
  francecentral: 'FR Central',
  germanywestcentral: 'DE West Central',
  japaneast: 'JP East',
  koreacentral: 'KR Central',
  northeurope: 'EU North',
  southcentralus: 'US South Central',
  southeastasia: 'AP Southeast',
  swedencentral: 'SE Central',
  uksouth: 'UK South',
  ukwest: 'UK West',
  westus: 'US West',
  westus2: 'US West 2',
  westeurope: 'EU West',
};

export function numberSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolvePriceSheetRegion(referenceRegion: string): string | null {
  return PRICE_SHEET_REGION_BY_REFERENCE_REGION[referenceRegion.trim().toLowerCase()] ?? null;
}

function unitHours(unitOfMeasure: string): number {
  const match = /^\s*(\d+)/.exec(unitOfMeasure);
  if (!match) return 0;

  const hours = Number(match[1]);
  return Number.isFinite(hours) ? hours : 0;
}

export function findVmHourlyPrice(priceSheet: PriceSheetRow[], skuName: string): number {
  const skuNameParts = skuName.split('_');
  let candidates: PriceSheetRow[] = [];

  if (skuNameParts.length === 3) {
    const skuNameFilter = skuNameParts[1].toLowerCase();
    const skuVersionFilter = skuNameParts[2].toLowerCase();
    candidates = priceSheet.filter((row) => {
      const meterName = row.MeterName.toLowerCase();
      const meterSubCategory = row.MeterSubCategory.toLowerCase();

      return (
        meterName.includes(` ${skuNameFilter} `) &&
        !meterName.includes('low priority') &&
        !meterName.includes('expired') &&
        meterName.includes(skuVersionFilter) &&
        !meterSubCategory.includes('windows') &&
        row.UnitPrice !== 0
      );
    });

    if (candidates.length > 2) {
      const skuFilter = `${skuNameParts[1]} ${skuNameParts[2]}`.toLowerCase();
      candidates = candidates.filter((row) => row.MeterName.toLowerCase().includes(skuFilter));
    }
  }

  if (skuNameParts.length === 2) {
    const skuNameFilter = skuNameParts[1].toLowerCase();
    candidates = priceSheet.filter((row) => {
      const meterName = row.MeterName.toLowerCase();
      const meterSubCategory = row.MeterSubCategory.toLowerCase();

      return (
        meterName.includes(skuNameFilter) &&
        !meterName.includes('low priority') &&
        !meterName.includes('expired') &&
        !/ v\d/.test(meterName) &&
        !meterSubCategory.includes('windows') &&
        row.UnitPrice !== 0
      );
    });

    if (candidates.length > 2) {
      candidates = candidates.filter((row) => {
        const meterName = row.MeterName.toLowerCase();
        return meterName.includes(`${skuNameParts[1]}/`.toLowerCase()) || meterName.includes(`/${skuNameParts[1]}`.toLowerCase());
      });
    }
  }

  const price = candidates[0];
  if (!price) return Number.POSITIVE_INFINITY;

  const hours = unitHours(price.UnitOfMeasure);
  if (hours <= 0) return Number.POSITIVE_INFINITY;

  return price.UnitPrice / hours;
}

export function findDiskMonthlyPrice(priceSheet: PriceSheetRow[], diskSizeTier: string): number {
  const candidates = priceSheet.filter((row) => row.MeterName.replace(/ Disks?$/i, '') === diskSizeTier);
  if (candidates.length === 0) return Number.POSITIVE_INFINITY;

  return Math.min(...candidates.map((row) => row.UnitPrice));
}

export function toImpact(value: string | null | undefined, fallback: Recommendation['impact']): Recommendation['impact'] {
  if (value === 'High' || value === 'Medium' || value === 'Low') {
    return value;
  }

  return fallback;
}
