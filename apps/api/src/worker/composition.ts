import 'reflect-metadata';
import { OPTIONAL_DEPS_METADATA, PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { AccountTree } from '../modules/access/account-tree';
import { ActorResolver } from '../modules/access/actor-resolver';
import { ActivationSettlement } from '../modules/office/lines/activation-settlement';
import { LinePricing } from '../modules/office/lines/line-pricing';
import { LinesRepository } from '../modules/office/lines/lines.repository';
import { TaskCompletion } from '../modules/office/lines/task-completion';
import { ProviderOperationsRepository } from '../modules/office/providers/operations/provider-operations.repository';
import { ProviderOperationsService } from '../modules/office/providers/operations/provider-operations.service';
import { TasksRepository } from '../modules/office/tasks/tasks.repository';
import { TasksService } from '../modules/office/tasks/tasks.service';
import { PriceLadder } from '../modules/office/terms/price-ladder';
import { WalletLedger } from '../modules/office/wallets/wallet-ledger';

// The worker's money path, composed from ONE description (slice R.5; audit finding H2). Before it, the worker
// called `new` on each class with its arguments written out by hand, beside the Nest modules that build the same
// classes for the API: a collaborator added on one side could be missed on the other.
//
// Now the worker builds these classes the way Nest does: from the constructor metadata the compiler emits for
// every `@Injectable()` class (`design:paramtypes`) and the tokens Nest's `@Inject()` and `@Optional()` record. So
// a constructor that gains a collaborator is given it in the worker as in the API, from the same declaration, or
// the worker refuses to start naming what it lacks. What the worker gives by hand is listed (`WorkerGiven`): its
// unit of work (on its own client), the auth store it never uses, and, for specs, an operations service.
//
// No Nest application is started: no lifecycle hook runs, no module's timer starts (the API's provider health,
// the line snapshots and the catalog seed stay the API's). `worker-wiring.spec.ts` holds the description to the
// API's providers: every class here is registered by the API as itself.

/** The classes of the money path the worker builds (a verdict's settlement and what it writes through). */
export const WORKER_MONEY_PATH = [
  AccountTree,
  ActorResolver,
  PriceLadder,
  WalletLedger,
  LinesRepository,
  TasksRepository,
  ProviderOperationsRepository,
  ProviderOperationsService,
  TasksService,
  LinePricing,
  TaskCompletion,
  ActivationSettlement,
] as const;

/** The classes of `WORKER_MONEY_PATH` that the API does not register: the settlement runs in the worker only. */
export const WORKER_ONLY: readonly unknown[] = [ActivationSettlement];

/** What the worker hands in rather than builds, by Nest token: a class or an injection token. */
export type WorkerGiven = ReadonlyMap<unknown, unknown>;

const nameOf = (token: unknown) => (typeof token === 'function' ? token.name : String(token));

/**
 * The instance of `root`, and of everything it needs, built once each from the description: one unit of work, one
 * ledger, one task service in the whole graph. A token is taken from `given` first, then built when it is a class
 * of the description; an `@Optional()` one is left undefined; anything else is refused by name. `description` is
 * `WORKER_MONEY_PATH`; a spec may pass its own to prove the resolution.
 */
export function composeWorker<T>(root: abstract new (...args: never[]) => T, given: WorkerGiven, description: readonly unknown[] = WORKER_MONEY_PATH): T {
  const built = new Map<unknown, unknown>(given);
  const known = new Set<unknown>(description);
  const building = new Set<unknown>();
  const make = (token: unknown, by: string): unknown => {
    if (built.has(token)) return built.get(token);
    if (!known.has(token)) throw new Error(`worker composition: ${by} needs ${nameOf(token)}, which the worker neither builds nor is given`);
    if (building.has(token)) throw new Error(`worker composition: ${nameOf(token)} depends on itself`);
    building.add(token);
    const type = token as new (...args: unknown[]) => unknown;
    const params: unknown[] = Reflect.getMetadata(PARAMTYPES_METADATA, type) ?? [];
    if (type.length > 0 && params.length === 0) throw new Error(`worker composition: ${type.name} has no constructor metadata (is it @Injectable()?)`);
    const declared: { index: number; param: unknown }[] = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, type) ?? [];
    const optional: number[] = Reflect.getMetadata(OPTIONAL_DEPS_METADATA, type) ?? [];
    const args = params.map((param, index) => {
      const wanted = declared.find((entry) => entry.index === index)?.param ?? param;
      if (!built.has(wanted) && !known.has(wanted) && optional.includes(index)) return undefined;
      return make(wanted, type.name);
    });
    const instance = new type(...args);
    building.delete(token);
    built.set(token, instance);
    return instance;
  };
  return make(root, 'the worker') as T;
}
