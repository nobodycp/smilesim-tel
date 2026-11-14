import { LineAccess } from '../sales/line-access';
import { LayerRoles } from '../access/roles/layer-roles';
import { PriceLadder } from '../pricing/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from '../access/account-tree';
import { ActorResolver } from '../access/actor-resolver';
import { UnitOfWork } from '../platform/unit-of-work';

/**
 * The collaborators the office services are built from, wherever their module is. A spec app that serves the
 * routes over one service's own in-memory tables replaces exactly these (`testing/office-graph.ts` `providers()`).
 */
export const SHARED_COLLABORATORS = [UnitOfWork, AccountTree, ActorResolver, LayerRoles, PriceLadder, WalletLedger, LineAccess];
