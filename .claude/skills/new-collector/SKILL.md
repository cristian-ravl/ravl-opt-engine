---
name: new-collector
description: Scaffold a new Azure collector with implementation, registration, and test stub
---

Create a new Azure resource collector following the existing project patterns.

## Required Input

Ask the user for:
- **Collector name** (e.g., "cosmosdb", "redis-cache") — used for file naming and IDs
- **Azure resource type** (e.g., "Microsoft.DocumentDB/databaseAccounts") — the ARM resource type
- **Target suffix** (e.g., "cosmosdbaccounts") — the blob container and ADX table target
- **Key properties to collect** — which ARM properties matter for recommendations

## Scaffold Steps

### 1. Create collector file

Create `functions/src/providers/azure/collectors/{name}-collector.ts` following this pattern:

```typescript
import type { EngineContext, ICollector, CloudProvider } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { resolveSubscriptionIds } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';
import { queryArg } from '../../../utils/arg-client.js';

export class {PascalName}Collector implements ICollector {
  readonly id = 'azure-{name}';
  readonly name = 'Azure {display name}';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = '{target-suffix}';

  async collect(ctx: EngineContext): Promise<number> {
    // Use Azure Resource Graph for discovery
    const kql = `Resources | where type =~ "{resource-type}"`;
    const subscriptions = await resolveSubscriptionIds(ctx);
    const rows = await queryArg(kql, subscriptions);
    // ... map properties, upload, ingest
  }
}
```

Look at existing collectors for the best reference pattern:
- `vm-collector.ts` — ARG-based collection with property mapping
- `disk-collector.ts` — simpler ARG pattern
- `consumption-collector.ts` — ARM API direct calls (for non-ARG resources)

### 2. Register the collector

Add the import and registration in `functions/src/providers/azure/collectors/index.ts`.

### 3. Update ADX schema

If a new table is needed, add the table definition in `functions/src/config/adx-schema.kql`.

### 4. Add to status API table counts

Add the new table name to the union query in `functions/src/api/status.ts` so it appears in the Data inventory dashboard section.

### 5. Create test stub

Create `functions/src/providers/azure/collectors/{name}-collector.test.ts` with at least:
- A test that the collector has the correct `id`, `name`, `cloud`, and `targetSuffix`
- A test skeleton for the `collect()` method

### 6. Validate

Run `/validate` to confirm everything compiles and tests pass.
