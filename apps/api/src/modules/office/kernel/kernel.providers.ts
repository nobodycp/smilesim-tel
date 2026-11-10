import { LineAccess } from '../lines/line-access';
import { LayerRoles } from '../roles/layer-roles';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { UnitOfWork } from './unit-of-work';

/**
 * What the office services are built from: the database and its transactions, the account tree, the signed-in
 * actor, the layer roles, the price ladder, the wallet ledger and line access. Listed here until each lives in its
 * own domain module (plan `2026-11-10-office-kernel-split`, phase M).
 */
export const KERNEL_PROVIDERS = [UnitOfWork, AccountTree, ActorResolver, LayerRoles, PriceLadder, WalletLedger, LineAccess];
