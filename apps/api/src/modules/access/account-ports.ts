import type { Prisma } from '../../generated/prisma/client';

// What the life of an account asks of the modules above access (slice R.8; audit section 3.3, rule 4: the lower
// module declares the port, the higher one provides it). Access sits below wallets and tasks, yet removing an
// account locks its wallet in the removal's own transaction, and freezing one hands its open tasks back. The calls,
// their order and their transaction are as before; only who is named changed.

/** Bound by wallets to `WalletLedger` (`AccountWalletsModule`): the same `lockWallets`, in the caller's transaction. */
export abstract class AccountWallets {
  abstract lockWallets(tx: Prisma.TransactionClient, userIds: string[]): Promise<void>;
}

/** Bound by tasks to `TasksService` (`AccountTasksModule`): the tasks a frozen account was working on go back to the pool. */
export abstract class AccountTasks {
  abstract releaseHandledBy(userId: string): Promise<void>;
}
