import type { EngineContext, Recommendation, RemediationLog } from '../../types.js';
import { armGet, armRequest } from '../../../utils/arm-client.js';
import { AzureRemediator, isRemediationSimulationEnabled } from './base-remediator.js';

type DiskResource = {
  properties?: {
    managedBy?: string;
  };
  sku?: {
    name?: string;
  };
};

function targetDiskSku(currentSku: string): { name: string; tier: string } | null {
  if (currentSku === 'Standard_LRS' || currentSku === 'StandardSSD_ZRS') return null;
  if (currentSku.endsWith('_LRS') && !currentSku.includes('V2')) {
    return { name: 'Standard_LRS', tier: 'Standard' };
  }
  if (currentSku.endsWith('_ZRS') && !currentSku.includes('V2')) {
    return { name: 'StandardSSD_ZRS', tier: 'Standard' };
  }
  return null;
}

export class UnattachedDisksRemediator extends AzureRemediator {
  readonly id = 'unattached-disks';
  readonly name = 'Unattached disks remediator';
  readonly handlesSubTypeIds = ['c84d5e86-e2d6-4d62-be7c-cecfbd73b0db'];

  async remediate(recommendation: Recommendation, context: EngineContext): Promise<RemediationLog> {
    const simulate = isRemediationSimulationEnabled();
    const action = (process.env.OE_REMEDIATE_UNATTACHED_DISKS_ACTION ?? 'Delete').toLowerCase();

    try {
      const disk = await armGet<DiskResource>(`${recommendation.instanceId}?api-version=2023-04-02`);
      if (disk.properties?.managedBy) {
        const log = this.createLog(recommendation, action, 'Skipped', 'Disk is no longer unattached');
        await this.persistLog(context, log);
        return log;
      }

      if (!simulate) {
        if (action === 'downsize') {
          const nextSku = targetDiskSku(String(disk.sku?.name ?? ''));
          if (!nextSku) {
            const log = this.createLog(recommendation, action, 'Skipped', 'Disk is already in the lowest supported SKU');
            await this.persistLog(context, log);
            return log;
          }

          await armRequest(`${recommendation.instanceId}?api-version=2023-04-02`, 'PATCH', {
            sku: nextSku,
          });
        } else {
          await armRequest(`${recommendation.instanceId}?api-version=2023-04-02`, 'DELETE');
        }
      }

      const log = this.createLog(recommendation, simulate ? `${action}-simulate` : action, 'Succeeded');
      await this.persistLog(context, log);
      return log;
    } catch (error: unknown) {
      const log = this.createLog(recommendation, action, 'Failed', error instanceof Error ? error.message : String(error));
      await this.persistLog(context, log);
      return log;
    }
  }
}
