import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { ingestCollectorRows } from './ingestion.js';

type RetailPriceResponse = {
  Items?: Array<Record<string, unknown>>;
  NextPageLink?: string;
};

const DEFAULT_FILTER = "serviceName eq 'Virtual Machines' and priceType eq 'Reservation'";

function encodeFilter(value: string): string {
  return encodeURIComponent(value);
}

export class ReservationsPriceCollector implements ICollector {
  readonly id = 'azure-reservations-price';
  readonly name = 'Azure reservations retail prices';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'reservationspriceexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const currencyCode = process.env.OE_RETAIL_PRICES_CURRENCY_CODE ?? 'USD';
    const filter = process.env.OE_RETAIL_PRICES_FILTER ?? DEFAULT_FILTER;
    let nextPage = `https://prices.azure.com/api/retail/prices?currencyCode='${currencyCode}'&$filter=${encodeFilter(filter)}`;
    const rows: Record<string, unknown>[] = [];

    while (nextPage) {
      const response = await fetch(nextPage);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Retail prices request failed (${response.status} ${response.statusText}): ${body}`);
      }

      const payload = (await response.json()) as RetailPriceResponse;
      for (const item of payload.Items ?? []) {
        rows.push({
          timestamp,
          cloud: 'Azure',
          currencyCode: String(item.currencyCode ?? currencyCode),
          serviceName: String(item.serviceName ?? ''),
          armSkuName: String(item.armSkuName ?? ''),
          armRegionName: String(item.armRegionName ?? ''),
          reservationTerm: String(item.reservationTerm ?? ''),
          meterName: String(item.meterName ?? ''),
          meterId: String(item.meterId ?? ''),
          skuName: String(item.skuName ?? ''),
          productName: String(item.productName ?? ''),
          unitOfMeasure: String(item.unitOfMeasure ?? ''),
          unitPrice: Number(item.unitPrice ?? 0),
          retailPrice: Number(item.retailPrice ?? item.unitPrice ?? 0),
          type: String(item.type ?? ''),
          priceType: String(item.priceType ?? ''),
        });
      }

      nextPage = payload.NextPageLink ?? '';
    }

    if (rows.length === 0) return 0;

    const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}.ndjson`;
    await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
    await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
    return rows.length;
  }
}
