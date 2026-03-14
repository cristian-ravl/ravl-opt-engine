using 'main.bicep'

// Budget tier: Consumption Functions, Free SWA, Dev ADX cluster
// Estimated cost: ~$150-170/month (mostly ADX Dev SKU; near $0 when auto-stopped)
// To eliminate ADX costs entirely, set existingAdxClusterUri to an existing cluster URI

param nameSuffix = 'finops'
param deploymentTier = 'Budget'
