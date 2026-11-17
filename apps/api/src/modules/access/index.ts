// The public surface of the access module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { AccessModule } from './access.module';
export { AccountTasks, AccountWallets } from './account-ports';
export { AccountTree, accountsById, nodeOf } from './account-tree';
export { visibleAccountIds } from './account-visibility';
export type { AccountNode } from './account-visibility';
export { ActorResolver } from './actor-resolver';
export { Actor, ActorInterceptor } from './actor.interceptor';
export type { GrantCode } from './grants';
export { assertBranch, granted, holds, holdsAny, isOwner, refuseEntered, requireAnyGrant, requireGrant, requireOwner, seesLayer } from './policy';
export { LayerRoles } from './roles/layer-roles';
export { RolesModule } from './roles/roles.module';
export type { Account, PathNode } from './types';
