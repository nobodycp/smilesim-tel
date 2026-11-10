import { LineAccess } from '../lines/line-access';
import { LayerRoles } from '../roles/layer-roles';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { UnitOfWork } from './unit-of-work';

/**
 * The collaborators the office services are built from, wherever their module is. A spec app that serves the
 * routes over one service's own in-memory tables replaces exactly these (`testing/office-graph.ts` `providers()`).
 */
export const KERNEL_PROVIDERS = [UnitOfWork, AccountTree, ActorResolver, LayerRoles, PriceLadder, WalletLedger, LineAccess];
