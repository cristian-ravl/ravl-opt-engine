// Collector: Azure price sheet exports (EA and MCA) for recommendation cost augmentation parity.

import { inflateRawSync } from 'node:zlib';
import { DefaultAzureCredential } from '@azure/identity';
import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { ingestCollectorRows } from './ingestion.js';

const ARM_BASE_URL = 'https://management.azure.com';
const ARM_SCOPE = 'https://management.azure.com/.default';
const credential = new DefaultAzureCredential();

type HeaderMap = Record<string, number>;
type PriceSheetPollResponse = {
  publishedEntity?: {
    properties?: {
      downloadUrl?: string;
    };
  };
  properties?: {
    downloadUrl?: string;
  };
};

const HEADER_ALIASES: Record<string, string> = {
  'meter id': 'meterid',
  meterid: 'meterid',
  'meter name': 'metername',
  metername: 'metername',
  'meter category': 'metercategory',
  metercategory: 'metercategory',
  'meter sub-category': 'metersubcategory',
  metersubcategory: 'metersubcategory',
  'meter region': 'meterregion',
  meterregion: 'meterregion',
  'unit of measure': 'unitofmeasure',
  unitofmeasure: 'unitofmeasure',
  'part number': 'partnumber',
  partnumber: 'partnumber',
  'unit price': 'unitprice',
  unitprice: 'unitprice',
  'currency code': 'currencycode',
  currency: 'currencycode',
  currencycode: 'currencycode',
  'included quantity': 'includedquantity',
  includedquantity: 'includedquantity',
  'offer id': 'offerid',
  offerid: 'offerid',
  term: 'term',
  'price type': 'pricetype',
  pricetype: 'pricetype',
};

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? key.replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }

  values.push(current);
  return values;
}

function buildHeaderMap(line: string): HeaderMap {
  const columns = parseCsvLine(line);
  const map: HeaderMap = {};
  for (let i = 0; i < columns.length; i++) {
    map[normalizeHeader(columns[i])] = i;
  }
  return map;
}

function getColumn(values: string[], headers: HeaderMap, key: string): string {
  const idx = headers[key];
  if (idx === undefined || idx < 0 || idx >= values.length) return '';
  return values[idx]?.trim() ?? '';
}

function toNumber(input: string): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function getBillingPeriod(consumptionOffsetDays: number): string {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() - Math.max(consumptionOffsetDays, 0));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

async function getArmToken(): Promise<string> {
  const token = await credential.getToken(ARM_SCOPE);
  if (!token?.token) {
    throw new Error('Failed to acquire ARM access token for pricesheet collector');
  }
  return token.token;
}

async function armRequest(pathOrUrl: string, token: string, method: 'GET' | 'POST'): Promise<Response> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${ARM_BASE_URL}${pathOrUrl}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
}

async function pollPriceSheetDownloadLocation(locationPath: string, token: string): Promise<string | null> {
  const maxTries = 30;
  let waitSeconds = 10;
  let currentPath = locationPath;

  for (let i = 0; i < maxTries; i++) {
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    const response = await armRequest(currentPath, token, 'GET');

    if (response.status === 202) {
      waitSeconds = Math.max(Number(response.headers.get('retry-after') ?? '10'), 5);
      const nextLocation = response.headers.get('location');
      if (nextLocation) currentPath = nextLocation;
      continue;
    }

    if (response.status !== 200) {
      return null;
    }

    const bodyText = await response.text();
    const payload = bodyText ? (JSON.parse(bodyText) as PriceSheetPollResponse) : {};
    const mcaDownload = payload?.publishedEntity?.properties?.downloadUrl;
    const eaDownload = payload?.properties?.downloadUrl;
    return (mcaDownload ?? eaDownload ?? null) as string | null;
  }

  return null;
}

function shouldKeepRow(meterCategory: string, meterRegion: string, meterCategoryFilter: string[], meterRegionFilter: string[]): boolean {
  const keepByCategory = meterCategoryFilter.length === 0 || meterCategoryFilter.some((c) => c.toLowerCase() === meterCategory.toLowerCase());
  const keepByRegion = meterRegionFilter.length === 0 || meterRegionFilter.some((r) => r.toLowerCase() === meterRegion.toLowerCase());
  return keepByCategory && keepByRegion;
}

type ZipEntry = {
  compressionMethod: number;
  compressedSize: number;
  fileName: string;
  localHeaderOffset: number;
};

function findEndOfCentralDirectoryOffset(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('Pricesheet ZIP archive is missing an end-of-central-directory record');
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let currentOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(currentOffset) !== 0x02014b50) {
      throw new Error('Pricesheet ZIP archive has an invalid central-directory entry');
    }

    const compressionMethod = buffer.readUInt16LE(currentOffset + 10);
    const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const fileNameLength = buffer.readUInt16LE(currentOffset + 28);
    const extraFieldLength = buffer.readUInt16LE(currentOffset + 30);
    const fileCommentLength = buffer.readUInt16LE(currentOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(currentOffset + 42);
    const fileName = buffer.subarray(currentOffset + 46, currentOffset + 46 + fileNameLength).toString('utf8');

    entries.push({
      compressionMethod,
      compressedSize,
      fileName,
      localHeaderOffset,
    });

    currentOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Pricesheet ZIP archive has an invalid local header for '${entry.fileName}'`);
  }

  const compressionMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8);
  const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraFieldLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  switch (compressionMethod) {
    case 0:
      return compressed;
    case 8:
      return inflateRawSync(compressed);
    default:
      throw new Error(`Pricesheet ZIP archive uses unsupported compression method '${compressionMethod}'`);
  }
}

export function extractFirstCsvFromZip(buffer: Buffer): string {
  const csvEntry = listZipEntries(buffer).find((entry) => !entry.fileName.endsWith('/') && entry.fileName.toLowerCase().endsWith('.csv'));
  if (!csvEntry) {
    throw new Error('Pricesheet ZIP archive did not contain a CSV file');
  }

  return stripUtf8Bom(extractZipEntry(buffer, csvEntry).toString('utf8'));
}

export function decodePriceSheetDownload(download: ArrayBuffer, contentType: string, downloadUrl: string): string {
  const buffer = Buffer.from(download);
  const normalizedContentType = contentType.toLowerCase();

  if (normalizedContentType.includes('zip') || downloadUrl.toLowerCase().endsWith('.zip')) {
    return extractFirstCsvFromZip(buffer);
  }

  return stripUtf8Bom(buffer.toString('utf8'));
}

function parsePriceSheetRows(
  csvText: string,
  timestamp: string,
  billingAccountId: string,
  billingProfileId: string,
  billingPeriod: string,
  meterCategoryFilter: string[],
  meterRegionFilter: string[],
): Record<string, unknown>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  let headerLineIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].toLowerCase().includes('meter')) {
      headerLineIndex = i;
      break;
    }
  }

  const headers = buildHeaderMap(lines[headerLineIndex]);
  const rows: Record<string, unknown>[] = [];

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const meterCategory = getColumn(values, headers, 'metercategory');
    const meterRegion = getColumn(values, headers, 'meterregion');
    if (!shouldKeepRow(meterCategory, meterRegion, meterCategoryFilter, meterRegionFilter)) continue;

    rows.push({
      timestamp,
      cloud: 'Azure',
      billingAccountId,
      billingProfileId,
      billingPeriod,
      meterId: getColumn(values, headers, 'meterid'),
      meterName: getColumn(values, headers, 'metername'),
      meterCategory,
      meterSubCategory: getColumn(values, headers, 'metersubcategory'),
      meterRegion,
      unitOfMeasure: getColumn(values, headers, 'unitofmeasure'),
      partNumber: getColumn(values, headers, 'partnumber'),
      unitPrice: toNumber(getColumn(values, headers, 'unitprice')),
      currencyCode: getColumn(values, headers, 'currencycode'),
      includedQuantity: toNumber(getColumn(values, headers, 'includedquantity')),
      offerId: getColumn(values, headers, 'offerid'),
      term: getColumn(values, headers, 'term'),
      priceType: getColumn(values, headers, 'pricetype'),
    });
  }

  return rows;
}

export class PriceSheetCollector implements ICollector {
  readonly id = 'azure-pricesheet';
  readonly name = 'Azure pricesheet';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'pricesheetexports';

  async collect(ctx: EngineContext): Promise<number> {
    const billingAccountId = process.env.OE_BILLING_ACCOUNT_ID ?? '';
    const billingProfileId = process.env.OE_BILLING_PROFILE_ID ?? '';

    if (!billingAccountId) {
      return 0;
    }

    const billingPeriod = process.env.OE_PRICE_SHEET_BILLING_PERIOD ?? getBillingPeriod(ctx.consumptionOffsetDays);
    const meterCategoryFilter = (process.env.OE_PRICE_SHEET_METER_CATEGORIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const meterRegionFilter = (process.env.OE_PRICE_SHEET_METER_REGIONS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const token = await getArmToken();
    const isMca = billingAccountId.includes(':') && billingAccountId.includes('_');

    if (isMca && !billingProfileId) {
      throw new Error('OE_BILLING_PROFILE_ID is required for MCA billing account pricesheet collection');
    }

    const requestPath = isMca
      ? `/providers/Microsoft.Billing/billingAccounts/${billingAccountId}/billingProfiles/${billingProfileId}/providers/Microsoft.CostManagement/pricesheets/default/download?api-version=2023-03-01&format=csv`
      : `/providers/Microsoft.Billing/billingAccounts/${billingAccountId}/billingPeriods/${billingPeriod}/providers/Microsoft.Consumption/pricesheets/download?api-version=2022-06-01&ln=en`;

    const response = await armRequest(requestPath, token, isMca ? 'POST' : 'GET');
    if (response.status === 204) {
      return 0;
    }
    if (response.status !== 200 && response.status !== 202) {
      const body = await response.text();
      throw new Error(`Pricesheet request failed (${response.status}): ${body}`);
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Pricesheet response did not include a Location header for polling');
    }

    const downloadUrl = await pollPriceSheetDownloadLocation(location, token);
    if (!downloadUrl) {
      throw new Error('Pricesheet export did not become available before retry limit');
    }

    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      const body = await downloadResponse.text();
      throw new Error(`Pricesheet download failed (${downloadResponse.status}): ${body}`);
    }

    const contentType = downloadResponse.headers.get('content-type') ?? '';
    const downloadBody = await downloadResponse.arrayBuffer();
    const csvText = decodePriceSheetDownload(downloadBody, contentType, downloadUrl);
    const timestamp = new Date().toISOString();
    const rows = parsePriceSheetRows(csvText, timestamp, billingAccountId, billingProfileId, billingPeriod, meterCategoryFilter, meterRegionFilter);

    if (rows.length === 0) {
      return 0;
    }

    const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}-${billingPeriod}.ndjson`;
    await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
    await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
    return rows.length;
  }
}
