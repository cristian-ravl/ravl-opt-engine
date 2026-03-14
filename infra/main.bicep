// Optimization Engine v2 — main Bicep deployment template
// Deploys: ADX cluster, Function App, Storage Account, Static Web App, App Insights
// Supports two deployment tiers:
//   - Standard: Elastic Premium Functions, Standard SWA, dedicated ADX cluster
//   - Budget:   Consumption Functions, Free SWA, optional BYO ADX cluster

targetScope = 'resourceGroup'

// ============================================================================
// Parameters
// ============================================================================

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Unique suffix for resource names (e.g., project abbreviation).')
@minLength(3)
@maxLength(12)
param nameSuffix string

@description('Deployment tier. "Standard" deploys Elastic Premium Functions and dedicated ADX. "Budget" uses Consumption plan, Free SWA, and allows bringing your own ADX cluster.')
@allowed(['Standard', 'Budget'])
param deploymentTier string = 'Standard'

@description('URI of an existing ADX cluster to use instead of deploying a new one. When set, no ADX cluster is created (saves ~$150/month). Requires the function app managed identity to have Admin role on the database.')
param existingAdxClusterUri string = ''

@description('ADX cluster SKU name. Only used when deploying a new ADX cluster.')
@allowed([
  'Dev(No SLA)_Standard_E2a_v4'
  'Standard_E2ads_v5'
  'Standard_E4ads_v5'
  'Standard_E8ads_v5'
])
param adxSkuName string = 'Dev(No SLA)_Standard_E2a_v4'

@description('ADX cluster tier. Only used when deploying a new ADX cluster.')
@allowed(['Basic', 'Standard'])
param adxSkuTier string = 'Basic'

@description('ADX cluster capacity (number of instances). Only used when deploying a new ADX cluster.')
@minValue(1)
@maxValue(10)
param adxCapacity int = 1

@description('Function App plan SKU. Overridden by deploymentTier when set to Budget (forces Y1).')
@allowed(['Y1', 'EP1', 'EP2'])
param functionPlanSku string = 'EP1'

@description('Enable AWS multi-cloud collection.')
param enableAws bool = false

@description('Enable GCP multi-cloud collection.')
param enableGcp bool = false

@description('Reference Azure region for pricing lookups.')
param referenceRegion string = 'westeurope'

@description('Threshold in days for long-deallocated VM recommendations.')
param longDeallocatedVmDays int = 30

@description('Threshold in days for Entra ID expiring credentials.')
param aadExpiringCredsDays int = 30

@description('Maximum recommended Entra ID credential validity period in days.')
param aadMaxCredValidityDays int = 730

@description('Optional billing scope override for reservations and savings plans collectors.')
param billingScope string = ''

@description('Optional billing account ID for reservations and savings plans collectors.')
param billingAccountId string = ''

@description('Optional billing profile ID for MCA reservations and savings plans collectors.')
param billingProfileId string = ''

@description('Currency code for retail reservations pricing collection.')
param retailPricesCurrencyCode string = 'USD'

@description('OData filter for retail reservations pricing collection.')
param retailPricesFilter string = 'serviceName eq ''Virtual Machines'' and priceType eq ''Reservation'''

@description('Run remediations in simulation mode by default.')
param remediationSimulate bool = true

@description('Action for unattached disk remediation. Delete or Downsize.')
@allowed([
  'Delete'
  'Downsize'
])
param remediateUnattachedDisksAction string = 'Delete'

@description('Cron expression for the data collection schedule.')
param collectionSchedule string = '0 0 2 * * *'

@description('Cron expression for the recommendation schedule.')
param recommendationSchedule string = '0 0 4 * * 1'

// ============================================================================
// Variables
// ============================================================================

var isBudget = deploymentTier == 'Budget'
var deployAdx = empty(existingAdxClusterUri)
var needsKeyVault = enableAws || enableGcp
var effectiveFunctionSku = isBudget ? 'Y1' : functionPlanSku
var effectiveSwaSkuName = isBudget ? 'Free' : 'Standard'
var effectiveSwaSkuTier = isBudget ? 'Free' : 'Standard'
var logRetentionDays = isBudget ? 30 : 90

var baseName = 'oe${nameSuffix}'
var adxClusterName = 'adx${baseName}'
var adxDatabaseName = 'OptimizationEngine'
var storageAccountName = 'st${baseName}'
var functionAppName = 'func-${baseName}'
var appServicePlanName = 'plan-${baseName}'
var appInsightsName = 'appi-${baseName}'
var logAnalyticsName = 'log-${baseName}'
var staticWebAppName = 'swa-${baseName}'
var keyVaultName = 'kv-${baseName}'

// ============================================================================
// Log Analytics workspace (for App Insights)
// ============================================================================

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
  }
}

// ============================================================================
// Application Insights
// ============================================================================

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ============================================================================
// Storage account (blob staging for ADX ingestion)
// ============================================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

// ============================================================================
// Azure Data Explorer cluster + database (skipped when using existing cluster)
// ============================================================================

resource adxCluster 'Microsoft.Kusto/clusters@2023-08-15' = if (deployAdx) {
  name: adxClusterName
  location: location
  sku: {
    name: adxSkuName
    tier: adxSkuTier
    capacity: adxCapacity
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    enableStreamingIngest: true
    enableAutoStop: true
  }
}

resource adxDatabase 'Microsoft.Kusto/clusters/databases@2023-08-15' = if (deployAdx) {
  parent: adxCluster
  name: adxDatabaseName
  location: location
  kind: 'ReadWrite'
  properties: {
    softDeletePeriod: 'P730D'
    hotCachePeriod: isBudget ? 'P31D' : 'P90D'
  }
}

// Bootstrap the Optimization Engine schema for managed ADX deployments.
// BYO ADX remains manual because this template only has the cluster URI, not the resource ID.
resource adxSchemaScript 'Microsoft.Kusto/clusters/databases/scripts@2024-04-13' = if (deployAdx) {
  parent: adxDatabase
  name: 'bootstrap-schema'
  properties: {
    continueOnErrors: false
    #disable-next-line use-secure-value-for-secure-inputs // Static schema DDL, not a secret.
    scriptContent: loadTextContent('../functions/src/config/adx-schema.kql')
  }
}

// ============================================================================
// Key Vault (only deployed when multi-cloud is enabled)
// ============================================================================

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (needsKeyVault) {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}

// ============================================================================
// Function App (Durable Functions — Elastic Premium or Consumption)
// ============================================================================

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: effectiveFunctionSku == 'Y1' ? 'functionapp' : 'elastic'
  sku: {
    name: effectiveFunctionSku
    tier: effectiveFunctionSku == 'Y1' ? 'Dynamic' : 'ElasticPremium'
  }
  properties: {
    maximumElasticWorkerCount: effectiveFunctionSku == 'Y1' ? 0 : 5
    reserved: true // Linux
  }
}

// Resolve ADX cluster URI: use deployed cluster if available, otherwise the provided URI
var resolvedAdxClusterUri = adxCluster.?properties.uri ?? existingAdxClusterUri

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'OE_ADX_CLUSTER_URI', value: resolvedAdxClusterUri }
        { name: 'OE_ADX_DATABASE', value: adxDatabaseName }
        { name: 'OE_STORAGE_ACCOUNT_NAME', value: storageAccount.name }
        { name: 'OE_REFERENCE_REGION', value: referenceRegion }
        { name: 'OE_LONG_DEALLOCATED_VM_DAYS', value: string(longDeallocatedVmDays) }
        { name: 'OE_AAD_EXPIRING_CREDS_DAYS', value: string(aadExpiringCredsDays) }
        { name: 'OE_AAD_MAX_CRED_VALIDITY_DAYS', value: string(aadMaxCredValidityDays) }
        { name: 'OE_BILLING_SCOPE', value: billingScope }
        { name: 'OE_BILLING_ACCOUNT_ID', value: billingAccountId }
        { name: 'OE_BILLING_PROFILE_ID', value: billingProfileId }
        { name: 'OE_RETAIL_PRICES_CURRENCY_CODE', value: retailPricesCurrencyCode }
        { name: 'OE_RETAIL_PRICES_FILTER', value: retailPricesFilter }
        { name: 'OE_REMEDIATION_SIMULATE', value: string(remediationSimulate) }
        { name: 'OE_REMEDIATE_UNATTACHED_DISKS_ACTION', value: remediateUnattachedDisksAction }
        { name: 'OE_COLLECTION_SCHEDULE', value: collectionSchedule }
        { name: 'OE_RECOMMENDATION_SCHEDULE', value: recommendationSchedule }
        { name: 'OE_AWS_ENABLED', value: string(enableAws) }
        { name: 'OE_GCP_ENABLED', value: string(enableGcp) }
      ]
    }
  }
}

// ============================================================================
// Static Web App (React dashboard)
// ============================================================================

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: staticWebAppName
  location: 'eastus2'
  sku: {
    name: effectiveSwaSkuName
    tier: effectiveSwaSkuTier
  }
  properties: {
    stagingEnvironmentPolicy: isBudget ? 'Disabled' : 'Enabled'
  }
}

// ============================================================================
// RBAC role assignments — Function App managed identity
// ============================================================================

// Reader on the current subscription (for ARG queries and resource inventory).
// Additional target subscriptions still require manual Reader grants.
module functionReaderRole 'modules/subscription-reader-role.bicep' = {
  name: 'functionReaderRole'
  scope: subscription()
  params: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Blob Data Contributor on the storage account
var storageBlobContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource functionStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, storageBlobContributorRoleId, storageAccount.id)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ADX Admin on the database (only when ADX is deployed here)
resource adxDatabaseAdmin 'Microsoft.Kusto/clusters/databases/principalAssignments@2023-08-15' = if (deployAdx) {
  parent: adxDatabase
  name: 'funcAppAdmin'
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'App'
    role: 'Admin'
    tenantId: subscription().tenantId
  }
}

// Key Vault Secrets User (only when Key Vault is deployed)
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
resource functionKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (needsKeyVault) {
  name: guid(functionApp.id, kvSecretsUserRoleId, keyVault.id)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Outputs
// ============================================================================

output deploymentTier string = deploymentTier
output adxClusterUri string = resolvedAdxClusterUri
output adxDatabaseName string = adxDatabaseName
output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output storageAccountName string = storageAccount.name
output staticWebAppHostName string = staticWebApp.properties.defaultHostname
output functionAppPrincipalId string = functionApp.identity.principalId
output keyVaultDeployed bool = needsKeyVault
output adxClusterDeployed bool = deployAdx
