using 'main.bicep'

// Bring-your-own ADX: Budget settings + existing ADX cluster (cheapest option)
// Estimated cost: ~$10-30/month (only pay-per-execution Functions + storage)
// Requires: ADX cluster with a database named "OptimizationEngine" and admin role
//           granted to this deployment's function app managed identity

param nameSuffix = 'finops'
param deploymentTier = 'Budget'
param existingAdxClusterUri = '' // Replace with your cluster URI, e.g. 'https://mycluster.westeurope.kusto.windows.net'
