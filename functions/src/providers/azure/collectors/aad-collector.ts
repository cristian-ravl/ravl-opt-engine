// Collector: Microsoft Entra application credentials for expiring credential recommendations.

import { DefaultAzureCredential } from '@azure/identity';
import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { ingestCollectorRows } from './ingestion.js';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const credential = new DefaultAzureCredential();

type GraphApplication = {
  id?: string;
  appId?: string;
  displayName?: string;
  passwordCredentials?: Array<{ keyId?: string; startDateTime?: string; endDateTime?: string }>;
  keyCredentials?: Array<{ keyId?: string; startDateTime?: string; endDateTime?: string; type?: string }>;
};

async function getGraphToken(): Promise<string> {
  const token = await credential.getToken(GRAPH_SCOPE);
  if (!token?.token) {
    throw new Error('Failed to acquire Microsoft Graph token for AAD collector');
  }
  return token.token;
}

async function graphGetAll<T = Record<string, unknown>>(path: string, token: string): Promise<T[]> {
  const all: T[] = [];
  let nextUrl: string | null = `${GRAPH_BASE_URL}${path}`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { value?: T[]; '@odata.nextLink'?: string };
    all.push(...(payload.value ?? []));
    nextUrl = payload['@odata.nextLink'] ?? null;
  }

  return all;
}

export class AadObjectsCollector implements ICollector {
  readonly id = 'azure-aad-objects';
  readonly name = 'Microsoft Entra application credentials';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'aadobjectsexports';

  async collect(ctx: EngineContext): Promise<number> {
    const token = await getGraphToken();
    const timestamp = new Date().toISOString();
    const tenantId = process.env.OE_TENANT_ID ?? '';

    const apps = await graphGetAll<GraphApplication>('/applications?$select=id,appId,displayName,passwordCredentials,keyCredentials', token);

    const rows: Record<string, unknown>[] = [];

    for (const app of apps) {
      const objectId = String(app.id ?? '');
      const appId = String(app.appId ?? '');
      const displayName = String(app.displayName ?? '');

      for (const credential of app.passwordCredentials ?? []) {
        rows.push({
          timestamp,
          cloud: 'Azure',
          tenantId,
          objectId,
          appId,
          displayName,
          credentialType: 'Password',
          credentialId: String(credential.keyId ?? ''),
          startDate: String(credential.startDateTime ?? ''),
          endDate: String(credential.endDateTime ?? ''),
          statusDate: timestamp,
        });
      }

      for (const credential of app.keyCredentials ?? []) {
        rows.push({
          timestamp,
          cloud: 'Azure',
          tenantId,
          objectId,
          appId,
          displayName,
          credentialType: String(credential.type ?? 'Key'),
          credentialId: String(credential.keyId ?? ''),
          startDate: String(credential.startDateTime ?? ''),
          endDate: String(credential.endDateTime ?? ''),
          statusDate: timestamp,
        });
      }
    }

    if (rows.length === 0) return 0;

    const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}.ndjson`;
    await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
    await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
    return rows.length;
  }
}
