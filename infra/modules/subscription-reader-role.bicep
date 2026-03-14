targetScope = 'subscription'

@description('Principal ID to grant Reader on the current subscription.')
param principalId string

@description('Principal type for the role assignment.')
@allowed([
  'ServicePrincipal'
  'User'
  'Group'
  'ForeignGroup'
  'Device'
])
param principalType string = 'ServicePrincipal'

var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

resource readerRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().subscriptionId, principalId, readerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRoleId)
    principalId: principalId
    principalType: principalType
  }
}
