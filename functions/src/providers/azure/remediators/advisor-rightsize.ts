import type { EngineContext, Recommendation, RemediationLog } from '../../types.js';
import { armGet, armRequest } from '../../../utils/arm-client.js';
import { AzureRemediator, isRemediationSimulationEnabled } from './base-remediator.js';

type VirtualMachineResource = {
  location?: string;
  tags?: Record<string, string>;
  identity?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  properties?: {
    hardwareProfile?: {
      vmSize?: string;
    };
    [key: string]: unknown;
  };
  zones?: string[];
};

export class AdvisorRightsizeRemediator extends AzureRemediator {
  readonly id = 'advisor-rightsize';
  readonly name = 'Advisor right-size remediator';
  readonly handlesSubTypeIds = ['e10b1381-5f0a-47ff-8c7b-37bd13d7c974'];

  async remediate(recommendation: Recommendation, context: EngineContext): Promise<RemediationLog> {
    const targetSku = String(recommendation.additionalInfo.targetSku ?? '');
    if (!targetSku) {
      const log = this.createLog(recommendation, 'resize-vm', 'Skipped', 'Recommendation did not include a target SKU');
      await this.persistLog(context, log);
      return log;
    }

    const simulate = isRemediationSimulationEnabled();

    try {
      const vm = await armGet<VirtualMachineResource>(`${recommendation.instanceId}?api-version=2023-09-01`);
      const currentSku = String(vm.properties?.hardwareProfile?.vmSize ?? '');
      if (currentSku === targetSku) {
        const log = this.createLog(recommendation, 'resize-vm', 'Skipped', 'VM is already using the target SKU');
        await this.persistLog(context, log);
        return log;
      }

      if (!simulate) {
        const updated = {
          ...vm,
          properties: {
            ...vm.properties,
            hardwareProfile: {
              ...vm.properties?.hardwareProfile,
              vmSize: targetSku,
            },
          },
        };

        await armRequest(`${recommendation.instanceId}?api-version=2023-09-01`, 'PUT', updated);
      }

      const log = this.createLog(recommendation, simulate ? 'resize-vm-simulate' : 'resize-vm', 'Succeeded');
      await this.persistLog(context, log);
      return log;
    } catch (error: unknown) {
      const log = this.createLog(recommendation, 'resize-vm', 'Failed', error instanceof Error ? error.message : String(error));
      await this.persistLog(context, log);
      return log;
    }
  }
}
