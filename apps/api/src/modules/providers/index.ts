// The public surface of the providers module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { ProviderAccountsService } from './account/provider-accounts.service';
export { ProviderHealthService } from './directory/provider-health.service';
export { NOT_CONNECTED, PROVIDER_GATEWAY } from './integration/gateway/provider-gateway';
export type { ProviderGateway } from './integration/gateway/provider-gateway';
export { RESULT_LIMITS, validKey } from './integration/operations/provider-operation.rules';
export type { OperationStatus } from './integration/operations/provider-operation.rules';
export { ProviderOperationsService } from './integration/operations/provider-operations.service';
export { ProvidersModule } from './providers.module';
