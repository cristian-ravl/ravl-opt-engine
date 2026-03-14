import type { EngineContext, Recommendation, RemediationLog } from '../../types.js';
import { armGet, armRequest } from '../../../utils/arm-client.js';
import { AzureRemediator, isRemediationSimulationEnabled } from './base-remediator.js';

type VirtualMachineStatus = {
  properties?: {
    storageProfile?: {
      osDisk?: {
        managedDisk?: {
          id?: string;
        };
      };
      dataDisks?: Array<{
        managedDisk?: {
          id?: string;
        };
      }>;
    };
    instanceView?: {
      statuses?: Array<{
        code?: string;
      }>;
    };
  };
};

type DiskResource = {
  sku?: {
    name?: string;
    tier?: string;
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

export class LongDeallocatedVmsRemediator extends AzureRemediator {
  readonly id = 'long-deallocated-vms';
  readonly name = 'Long deallocated VMs remediator';
  readonly handlesSubTypeIds = ['c320b790-2e58-452a-aa63-7b62c383ad8a'];

  async remediate(recommendation: Recommendation, context: EngineContext): Promise<RemediationLog> {
    const simulate = isRemediationSimulationEnabled();

    try {
      const vm = await armGet<VirtualMachineStatus>(`${recommendation.instanceId}?api-version=2023-09-01&$expand=instanceView`);
      const powerStates = vm.properties?.instanceView?.statuses?.map((status) => status.code ?? '') ?? [];
      if (!powerStates.some((code) => code === 'PowerState/deallocated')) {
        const log = this.createLog(recommendation, 'downgrade-disks', 'Skipped', 'VM is no longer deallocated');
        await this.persistLog(context, log);
        return log;
      }

      const diskIds = [
        vm.properties?.storageProfile?.osDisk?.managedDisk?.id,
        ...(vm.properties?.storageProfile?.dataDisks?.map((disk) => disk.managedDisk?.id) ?? []),
      ].filter((diskId): diskId is string => Boolean(diskId));

      if (diskIds.length === 0) {
        const log = this.createLog(recommendation, 'downgrade-disks', 'Skipped', 'VM does not use managed disks');
        await this.persistLog(context, log);
        return log;
      }

      for (const diskId of diskIds) {
        const disk = await armGet<DiskResource>(`${diskId}?api-version=2023-04-02`);
        const nextSku = targetDiskSku(String(disk.sku?.name ?? ''));
        if (!nextSku) continue;

        if (!simulate) {
          await armRequest(`${diskId}?api-version=2023-04-02`, 'PATCH', {
            sku: nextSku,
          });
        }
      }

      const log = this.createLog(recommendation, simulate ? 'downgrade-disks-simulate' : 'downgrade-disks', 'Succeeded');
      await this.persistLog(context, log);
      return log;
    } catch (error: unknown) {
      const log = this.createLog(recommendation, 'downgrade-disks', 'Failed', error instanceof Error ? error.message : String(error));
      await this.persistLog(context, log);
      return log;
    }
  }
}
