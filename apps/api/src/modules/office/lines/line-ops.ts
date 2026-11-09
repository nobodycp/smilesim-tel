import { fail } from '../../shared/office-failure';
import type { Account, Actor } from '../kernel/types';
import { resolvePackageMode, visibleAccountIds, type ActionKey } from '../office-rules';
import { isOpKey, type OpKey } from '../user-terms';

// Pure rules about which operation may run on a number. No database, no Nest.

/** The package fields that decide whether an operation is offered and how it runs. */
export type RunnablePackage = {
  enabled: boolean;
  allowActivate: boolean;
  allowCharge: boolean;
  allowDisconnect: boolean;
  allowFreeze: boolean;
  allowSwitch: boolean;
  allowExtend: boolean;
  allowRename: boolean;
  allowSim: boolean;
  actionModes?: unknown;
};

/** The stop key an operation answers to. `unfreeze` follows `freeze`; a restart is a `charge`. */
export function opKeyOf(action: string): OpKey | null {
  if (action === 'unfreeze') return 'freeze';
  if (action === 'reactivate') return 'charge';
  return isOpKey(action) ? action : null;
}

/** Who may activate for a point of sale: anyone above it in the viewer's tree, and the point of sale itself. */
export function canActivateFor(actor: Actor, pos: Account, accounts: Account[]): boolean {
  if (!visibleAccountIds(actor.id, actor.layer, accounts).has(pos.id)) return false;
  if (actor.layer === 'pos') return actor.id === pos.id;
  return true;
}

/** Whether the provider runs the operation at once (`auto`) instead of through a branch task. */
export function runsNow(pkg: RunnablePackage, action: ActionKey | 'unfreeze'): boolean {
  return resolvePackageMode(pkg.actionModes, pkg, action) === 'auto';
}

/** Refuses an operation the account is stopped from, a selling operation on a stopped package, or one switched off. */
export function assertRunnable(pkg: RunnablePackage, action: string, denied: ReadonlySet<OpKey> = new Set()): void {
  if (action === 'companySwitch') fail(400, 'INVALID');
  const stopKey = opKeyOf(action);
  if (stopKey && denied.has(stopKey)) fail(403, 'OPERATION_DENIED');
  const selling = action === 'activate' || action === 'charge' || action === 'extend' || action === 'reactivate' || action === 'switch';
  if (!pkg.enabled && selling) fail(400, 'PACKAGE_DISABLED');
  const mode = resolvePackageMode(pkg.actionModes, pkg, action as ActionKey | 'unfreeze');
  if (mode === 'off') fail(400, 'OPERATION_DISABLED');
}
