import type { Provider } from '@nestjs/common';
import { LineAccess } from '../lines/line-access';
import { LayerRoles } from '../roles/layer-roles';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { OfficeKernel } from './office-kernel';
import { UnitOfWork } from './unit-of-work';

/**
 * While the kernel is being taken apart (plan `2026-11-10-office-kernel-split`), the collaborators a service
 * injects are the ones the kernel built, so a service that already names its collaborators and one that still
 * goes through the kernel share one client, one transaction queue and one ledger. When no service injects the
 * kernel any more, these become plain class providers in their own modules and this file is deleted.
 */
const from = <T>(token: new (...args: never[]) => T, pick: (kernel: OfficeKernel) => T): Provider => ({
  provide: token,
  useFactory: pick,
  inject: [OfficeKernel],
});

export const KERNEL_PROVIDERS: Provider[] = [
  OfficeKernel,
  from(UnitOfWork, (kernel) => kernel.uow),
  from(AccountTree, (kernel) => kernel.tree),
  from(ActorResolver, (kernel) => kernel.actors),
  from(LayerRoles, (kernel) => kernel.layerRoles),
  from(PriceLadder, (kernel) => kernel.ladder),
  from(WalletLedger, (kernel) => kernel.ledger),
  from(LineAccess, (kernel) => kernel.lineAccess),
];
