using 'main.bicep'

// Standard tier: Elastic Premium Functions, Standard SWA, dedicated ADX cluster
// Estimated cost: ~$300-400/month (varies by region and usage)

param nameSuffix = 'finops'
param deploymentTier = 'Standard'
param functionPlanSku = 'EP1'
param adxSkuName = 'Dev(No SLA)_Standard_E2a_v4'
param adxSkuTier = 'Basic'
