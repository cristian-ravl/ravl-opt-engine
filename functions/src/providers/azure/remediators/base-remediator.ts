import { v4 as uuidv4 } from 'uuid';
import type { CloudProvider, EngineContext, IRemediator, Recommendation, RemediationLog } from '../../types.js';
import { ingest } from '../../../utils/adx-client.js';

export abstract class AzureRemediator implements IRemediator {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly handlesSubTypeIds: string[];
  readonly cloud: CloudProvider = 'Azure';

  abstract remediate(recommendation: Recommendation, context: EngineContext): Promise<RemediationLog>;

  protected createLog(
    recommendation: Recommendation,
    action: string,
    status: RemediationLog['status'],
    errorMessage: string | null = null,
  ): RemediationLog {
    return {
      remediationId: uuidv4(),
      recommendationId: recommendation.recommendationId,
      cloud: 'Azure',
      instanceId: recommendation.instanceId,
      action,
      status,
      executedAt: new Date().toISOString(),
      executedBy: 'system',
      errorMessage,
    };
  }

  protected async persistLog(ctx: EngineContext, log: RemediationLog): Promise<void> {
    await ingest(ctx, 'RemediationLog', [log], 'RemediationLog_mapping');
  }
}

export function isRemediationSimulationEnabled(): boolean {
  return (process.env.OE_REMEDIATION_SIMULATE ?? 'true').toLowerCase() !== 'false';
}
