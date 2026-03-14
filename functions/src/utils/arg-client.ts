// Shared utility: Azure Resource Graph paged query helper
// Re-usable by all Azure ARG-based collectors.

import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { DefaultAzureCredential } from '@azure/identity';
import type { EngineContext } from '../providers/types.js';

const PAGE_SIZE = 1000;

let _client: ResourceGraphClient | null = null;

function getClient(): ResourceGraphClient {
  if (!_client) {
    _client = new ResourceGraphClient(new DefaultAzureCredential());
  }
  return _client;
}

/**
 * Execute a paged Azure Resource Graph query and return all rows.
 * Automatically handles pagination via $skipToken.
 *
 * @param kql          The Kusto query to execute against ARG
 * @param ctx          Engine context (used for subscription scoping)
 * @param managementGroups  Optional management group scoping
 * @returns All result rows concatenated across pages
 */
export async function queryResourceGraph<T = Record<string, unknown>>(kql: string, ctx: EngineContext, managementGroups?: string[]): Promise<T[]> {
  const client = getClient();
  const allResults: T[] = [];
  let skipToken: string | undefined;

  const subscriptions = ctx.targetSubscriptions.length > 0 ? ctx.targetSubscriptions : undefined;

  do {
    const response = await client.resources({
      query: kql,
      options: {
        resultFormat: 'objectArray',
        ...(skipToken && { skipToken }),
        top: PAGE_SIZE,
      },
      ...(subscriptions && { subscriptions }),
      ...(managementGroups && { managementGroupIds: managementGroups }),
    });

    if (response.data && Array.isArray(response.data)) {
      allResults.push(...(response.data as T[]));
    }

    skipToken = response.skipToken ?? undefined;
  } while (skipToken);

  return allResults;
}
