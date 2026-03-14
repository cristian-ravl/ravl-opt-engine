// Collector: Azure RBAC role assignments.

import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll, resolveSubscriptionIds } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';

type RoleAssignment = {
  id?: string;
  properties?: {
    scope?: string;
    roleDefinitionId?: string;
    principalId?: string;
    principalType?: string;
    description?: string;
    condition?: string;
    conditionVersion?: string;
    createdOn?: string;
    updatedOn?: string;
  };
};

export class RbacAssignmentsCollector implements ICollector {
  readonly id = 'azure-rbac-assignments';
  readonly name = 'Azure RBAC assignments';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'rbacassignmentsexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const subscriptions = await resolveSubscriptionIds(ctx);
    const rows: Record<string, unknown>[] = [];

    for (const subscriptionId of subscriptions) {
      const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01`;
      const assignments = await armGetAll<RoleAssignment>(path);

      for (const assignment of assignments) {
        const props = assignment.properties ?? {};
        rows.push({
          timestamp,
          cloud: 'Azure',
          subscriptionId,
          roleAssignmentId: String(assignment.id ?? ''),
          scope: String(props.scope ?? ''),
          roleDefinitionId: String(props.roleDefinitionId ?? ''),
          principalId: String(props.principalId ?? ''),
          principalType: String(props.principalType ?? ''),
          description: String(props.description ?? ''),
          condition: String(props.condition ?? ''),
          conditionVersion: String(props.conditionVersion ?? ''),
          createdOn: String(props.createdOn ?? ''),
          updatedOn: String(props.updatedOn ?? ''),
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
