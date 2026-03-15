# Optimization Engine v2

A multi-cloud optimization engine built on Azure Durable Functions and Azure Data Explorer (ADX), replacing the original Azure Automation Account-based engine with a scalable, extensible, plugin-based architecture.

## Local prerequisites

- Functions backend: Node.js 22.13+ (Node 23 is not supported for this app)
- Dashboard: use the Node version declared by the `web/` package
- Azure Functions Core Tools v4 for local Functions execution
- Azure CLI login (`az login`) when running collectors locally against Azure, Storage, or ADX

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Timer / HTTP Triggers                                       │
│  ┌───────────────────┐  ┌───────────────────────────────┐   │
│  │ Collection Timer  │  │ Recommendation Timer          │   │
│  │ (daily 2am UTC)   │  │ (weekly Mon 4am UTC)          │   │
│  └────────┬──────────┘  └─────────────┬─────────────────┘   │
│           │                           │                      │
│  ┌────────▼──────────────────────────▼────────────────┐     │
│  │ Durable Functions Orchestrators                     │     │
│  │ ┌──────────────┐  ┌──────────────────────────────┐ │     │
│  │ │ Collection   │  │ Recommendation                │ │     │
│  │ │ Orchestrator │  │ Orchestrator                  │ │     │
│  │ └──────┬───────┘  └──────────┬───────────────────┘ │     │
│  │        │                     │                      │     │
│  │  ┌─────▼─────┐        ┌─────▼─────┐               │     │
│  │  │ Fan-out   │        │ Fan-out   │               │     │
│  │  │ per cloud │        │ per cloud │               │     │
│  │  └──┬──┬──┬──┘        └──┬──┬──┬──┘               │     │
│  └─────┼──┼──┼──────────────┼──┼──┼──────────────────┘     │
│        │  │  │              │  │  │                          │
│  ┌─────▼──▼──▼──────────────▼──▼──▼──────────────────┐     │
│  │ Cloud Provider Plugins                             │     │
│  │ ┌─────────────┐ ┌──────────┐ ┌──────────────────┐ │     │
│  │ │ Azure       │ │ AWS      │ │ GCP              │ │     │
│  │ │ • 24 ARG/API│ │ (scaffold│ │ (scaffold)       │ │     │
│  │ │ • cost      │ │ )        │ │                  │ │     │
│  │ │ • metrics   │ │          │ │                  │ │     │
│  │ │ • 17 recom. │ │          │ │                  │ │     │
│  │ │ • 3 remed.  │ │          │ │                  │ │     │
│  │ └──────┬──────┘ └──────────┘ └──────────────────┘ │     │
│  └────────┼──────────────────────────────────────────┘     │
│           │                                                  │
│  ┌────────▼──────────────────────────────────────────┐     │
│  │ Azure Data Explorer (Kusto)                        │     │
│  │ • VirtualMachines, ManagedDisks, etc.              │     │
│  │ • Recommendations, Suppressions                    │     │
│  │ • PerformanceMetrics, CostData                     │     │
│  └────────┬──────────────────────────────────────────┘     │
│           │                                                  │
│  ┌────────▼──────────────────────────────────────────┐     │
│  │ REST API & Web Dashboard                           │     │
│  │ • GET/POST /api/recommendations                    │     │
│  │ • CRUD /api/suppressions                           │     │
│  │ • GET /api/status                                  │     │
│  │ • React + Fluent UI dashboard                      │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Structure

```
ravl-opt-engine/
├── functions/           # Azure Durable Functions (TypeScript)
│   ├── src/
│   │   ├── api/         # REST API endpoints
│   │   ├── config/      # Configuration + ADX schema
│   │   ├── orchestrators/ # Durable Functions orchestrators
│   │   ├── providers/   # Cloud provider plugins
│   │   │   ├── azure/   # Azure collectors + recommenders
│   │   │   ├── aws/     # AWS plugin (scaffold)
│   │   │   └── gcp/     # GCP plugin (scaffold)
│   │   └── utils/       # Shared utilities (ADX, blob, ARG clients)
│   ├── package.json
│   ├── tsconfig.json
│   └── host.json
├── infra/               # Bicep IaC templates
│   └── main.bicep
├── web/                 # React dashboard (Vite + Fluent UI)
│   ├── src/
│   │   ├── pages/       # Dashboard, Recommendations, Suppressions, Status
│   │   ├── services/    # API client
│   │   └── hooks/       # React hooks
│   └── package.json
└── README.md
```

## Key improvements over v1

| Aspect            | v1 (Automation Account)  | v2 (Durable Functions + ADX)                    |
| ----------------- | ------------------------ | ----------------------------------------------- |
| **Language**      | PowerShell               | TypeScript                                      |
| **Orchestration** | Serial runbooks          | Parallel Durable Functions                      |
| **Data store**    | Azure SQL + Blob Storage | Azure Data Explorer (Kusto)                     |
| **Scalability**   | Single AA, memory-bound  | Elastic, fan-out/fan-in                         |
| **Multi-cloud**   | Azure only               | Azure + AWS + GCP plugins                       |
| **Extensibility** | Copy runbook scripts     | Implement `ICollector`/`IRecommender` interface |
| **API**           | None                     | REST API for all operations                     |
| **Dashboard**     | Workbooks only           | React + Fluent UI web app + Power BI            |
| **Suppressions**  | SQL table                | ADX-native + REST API                           |

## Cloud provider plugin system

Each cloud provider implements the `ICloudProvider` interface:

```typescript
interface ICloudProvider {
  readonly cloud: 'Azure' | 'AWS' | 'GCP';
  readonly collectors: ICollector[];
  readonly recommenders: IRecommender[];
  readonly remediators: IRemediator[];
}
```

### Adding a new collector

1. Create a class extending `BaseArgCollector` (Azure) or implementing `ICollector`
2. Define the ARG/API query and field mapping
3. Register in the provider's `collectors` array
4. Add corresponding ADX table in `adx-schema.kql`

### Adding a new recommender

1. Create a class extending `AzureRecommender` or implementing `IRecommender`
2. Define KQL queries against collected data
3. Define recommendation subtypes with stable GUIDs
4. Register in the provider's `recommenders` array

## Azure collectors (24)

| Collector               | Resource type                             | Source |
| ----------------------- | ----------------------------------------- | ------ |
| Virtual Machines        | Microsoft.Compute/virtualMachines         | ARG    |
| Managed Disks           | Microsoft.Compute/disks                   | ARG    |
| App Service Plans       | Microsoft.Web/serverFarms                 | ARG    |
| Load Balancers          | Microsoft.Network/loadBalancers           | ARG    |
| Application Gateways    | Microsoft.Network/applicationGateways     | ARG    |
| Network Interfaces      | Microsoft.Network/networkInterfaces       | ARG    |
| Network Security Groups | Microsoft.Network/networkSecurityGroups   | ARG    |
| Public IP Addresses     | Microsoft.Network/publicIPAddresses       | ARG    |
| Virtual Networks        | Microsoft.Network/virtualNetworks         | ARG    |
| SQL Databases           | Microsoft.Sql/servers/databases           | ARG    |
| VMSS                    | Microsoft.Compute/virtualMachineScaleSets | ARG    |
| Availability Sets       | Microsoft.Compute/availabilitySets        | ARG    |
| Resource Containers     | Subscriptions + Resource Groups           | ARG    |
| Unmanaged disks         | VM VHD references                         | ARG    |
| Advisor recommendations | Microsoft.Advisor/recommendations         | ARM    |
| Price sheet data        | Billing price sheet export                | ARM    |
| Reservations prices     | Retail reservation prices                 | Retail |
| Reservations usage      | Billing reservations summaries            | ARM    |
| Savings plans usage     | Billing savings plans summaries           | ARM    |
| Consumption cost data   | Microsoft.Consumption/usageDetails        | ARM    |
| Performance metrics     | Microsoft.Insights/metrics                | ARM    |
| AAD objects             | Microsoft Graph applications              | Graph  |
| RBAC assignments        | Microsoft.Authorization/roleAssignments   | ARM    |
| Policy compliance       | Policy states                             | ARG    |

## Azure recommenders (17)

| Recommender               | Category    | Subtypes |
| ------------------------- | ----------- | -------- |
| Long Deallocated VMs      | Cost        | 1        |
| Stopped VMs               | Cost        | 1        |
| Unattached Disks          | Cost        | 1        |
| Unused App Gateways       | Cost        | 1        |
| Unused Load Balancers     | Cost + OpEx | 2        |
| VM High Availability      | HA          | 11       |
| VNet Optimizations        | Cost + OpEx | 8        |
| App Service Optimizations | Cost + Perf | 3        |
| Advisor as-is             | OpEx/Sec/HA | dynamic  |
| Advisor cost augmented    | Cost        | dynamic  |
| VM optimizations          | Cost        | dynamic  |
| VMSS optimizations        | Cost + Perf | 2        |
| Disk optimizations        | Cost        | 1        |
| SQL DB optimizations      | Cost + Perf | 2        |
| Storage optimizations     | Cost        | 1        |
| ARM optimizations         | OpEx        | 3        |
| AAD expiring credentials  | Sec + OpEx  | 2        |

## Azure remediators (3)

| Remediator              | Handles |
| ----------------------- | ------- |
| Advisor right-size      | Advisor cost right-size recommendations |
| Long deallocated VMs    | Deallocated VM disk downgrade flow |
| Unattached disks        | Delete or downsize unattached disks |

## Optional settings for billing and benefits collection

Set these app settings when you want to ingest reservations prices, reservations usage, or savings plans usage:

- `OE_BILLING_SCOPE` (optional explicit scope override)
- `OE_BILLING_ACCOUNT_ID` (required unless `OE_BILLING_SCOPE` is set)
- `OE_BILLING_PROFILE_ID` (required for MCA billing accounts)
- `OE_RETAIL_PRICES_CURRENCY_CODE` (optional, default: `USD`)
- `OE_RETAIL_PRICES_FILTER` (optional, default reservation VM retail filter)

## Optional settings for remediation

- `OE_REMEDIATION_SIMULATE` keeps remediators in dry-run mode by default (`true`).
- `OE_REMEDIATE_UNATTACHED_DISKS_ACTION` controls unattached disk remediation (`Delete` or `Downsize`).

## API endpoints

| Method | Route                               | Description                         |
| ------ | ----------------------------------- | ----------------------------------- |
| GET    | `/api/recommendations`              | List recommendations with filters   |
| GET    | `/api/recommendations/summary`      | Aggregate counts by category/impact |
| GET    | `/api/recommendations/:id`          | Single recommendation detail        |
| GET    | `/api/data-explorer/tables`         | List ADX tables and materialized views exposed in the dashboard |
| GET    | `/api/data-explorer/tables/:name`   | Page through rows from one ADX table or materialized view |
| GET    | `/api/suppressions`                 | List active suppressions            |
| POST   | `/api/suppressions`                 | Create suppression                  |
| PUT    | `/api/suppressions/:id`             | Update suppression                  |
| DELETE | `/api/suppressions/:id`             | Delete (soft-disable) suppression   |
| GET    | `/api/status`                       | Engine health overview              |
| GET    | `/api/status/orchestrations`        | Recent orchestration instances      |
| GET    | `/api/providers`                    | Registered cloud providers          |
| POST   | `/api/remediations/{recommendationId}` | Execute a remediator for one recommendation |
| POST   | `/api/orchestrators/collection`     | Start collection run                |
| POST   | `/api/orchestrators/recommendation` | Start recommendation run            |

`GET /api/recommendations` supports filtering by `cloud`, `category`, `impact`, `subType`, `recommenderId`, `subscriptionId`, `resourceGroup`, `limit`, `offset`, and `includeSuppressed`.

Suppression notes: `Snooze` suppressions require a future `filterEndDate`, and suppression evaluation always uses the latest version of a `filterId`.

## Deployment

### Deployment tiers

The engine supports two deployment tiers to balance cost and performance:

| Resource           | Standard              | Budget                  |
| ------------------ | --------------------- | ----------------------- |
| **Function App**   | Elastic Premium (EP1) | Consumption (Y1)        |
| **Static Web App** | Standard ($9/mo)      | Free                    |
| **ADX cluster**    | Dedicated             | Dedicated (or BYO)      |
| **Log Analytics**  | 90-day retention      | 30-day retention        |
| **Key Vault**      | Always deployed       | Only if AWS/GCP enabled |
| **Estimated cost** | ~$300-400/mo          | ~$150-170/mo            |

**Bring-your-own ADX**: Set `existingAdxClusterUri` to connect to an existing ADX cluster instead of deploying one. This brings the budget tier down to ~$10-30/month (pay-per-execution only).

### Standard deployment

```bash
az deployment group create \
  --resource-group rg-finops-engine \
  --template-file infra/main.bicep \
  --parameters infra/parameters.standard.bicepparam
```

For managed ADX deployments created by this template, the ADX database schema is bootstrapped automatically during deployment.

The function app managed identity is also granted `Reader` on the current subscription so Azure Resource Graph collectors can inventory resources outside the deployment resource group. If you want to collect from additional subscriptions via `OE_TARGET_SUBSCRIPTIONS`, grant that identity `Reader` on each target subscription as well.

### Budget deployment

```bash
az deployment group create \
  --resource-group rg-finops-engine \
  --template-file infra/main.bicep \
  --parameters infra/parameters.budget.bicepparam
```

### BYO ADX deployment (cheapest)

```bash
az deployment group create \
  --resource-group rg-finops-engine \
  --template-file infra/main.bicep \
  --parameters infra/parameters.byoadx.bicepparam \
  --parameters existingAdxClusterUri='https://mycluster.westeurope.kusto.windows.net'
```

> After deploying with BYO ADX, grant the function app's managed identity the **Admin** role on the ADX database. The principal ID is in the deployment output `functionAppPrincipalId`.
>
> BYO ADX also requires a one-time schema bootstrap. In the ADX query window, connect to the `OptimizationEngine` database and run the contents of `functions/src/config/adx-schema.kql`. If you want to run the whole file at once, wrap it like this:
>
> ```kusto
> .execute database script <|
> // paste functions/src/config/adx-schema.kql here
> ```
>
> The ADX web UI executes only the current statement when nothing is selected, which is why pasting the raw file and pressing Run can look like only one table was created.

### Deploy function app and dashboard

```bash
# Build and deploy Functions
cd functions
nvm use
npm install && npm run build
func azure functionapp publish <function-app-name>

# Build and deploy dashboard
cd ../web
npm install && npm run build
# Deploy to Azure Static Web Apps or any static hosting
```

## Configuration

Set these environment variables (or Azure App Configuration):

| Variable                      | Description                  | Default              |
| ----------------------------- | ---------------------------- | -------------------- |
| `OE_ADX_CLUSTER_URI`          | ADX cluster URI              | required             |
| `OE_ADX_DATABASE`             | ADX database name            | `OptimizationEngine` |
| `OE_STORAGE_ACCOUNT_NAME`     | Storage account name         | required             |
| `OE_CLOUD_ENVIRONMENT`        | Azure cloud                  | `AzureCloud`         |
| `OE_REFERENCE_REGION`         | Pricing lookup region        | `westeurope`         |
| `OE_CONSUMPTION_OFFSET_DAYS`  | Days offset for cost data    | `7`                  |
| `OE_LONG_DEALLOCATED_VM_DAYS` | Deallocated VM threshold     | `30`                 |
| `OE_AAD_EXPIRING_CREDS_DAYS`  | Credential expiry threshold  | `30`                 |
| `OE_AAD_MAX_CRED_VALIDITY_DAYS` | Max recommended credential validity | `730`         |
| `OE_BILLING_SCOPE`            | Explicit billing scope override | empty            |
| `OE_BILLING_ACCOUNT_ID`       | Billing account for benefits collectors | empty    |
| `OE_BILLING_PROFILE_ID`       | Billing profile for MCA benefits collectors | empty |
| `OE_RETAIL_PRICES_CURRENCY_CODE` | Retail price currency      | `USD`                |
| `OE_RETAIL_PRICES_FILTER`     | Retail price filter           | reservation VM filter |
| `OE_REMEDIATION_SIMULATE`     | Default remediation mode      | `true`               |
| `OE_REMEDIATE_UNATTACHED_DISKS_ACTION` | Unattached disk remediation action | `Delete` |
| `OE_TARGET_SUBSCRIPTIONS`     | CSV of subscription IDs      | empty (all)          |
| `OE_COLLECTION_SCHEDULE`      | Collection CRON schedule     | `0 0 2 * * *`        |
| `OE_RECOMMENDATION_SCHEDULE`  | Recommendation CRON schedule | `0 0 4 * * 1`        |
| `OE_AWS_ENABLED`              | Enable AWS provider          | `false`              |
| `OE_GCP_ENABLED`              | Enable GCP provider          | `false`              |
