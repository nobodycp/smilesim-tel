import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { PROVIDER_OPERATION_KINDS } from '../provider-cost';

// Specs only. Wallet entries as they were stored before the provider ledger's first release (ADR 0025, P.1): an
// operation's entry with no provider and, for some kinds, no cost. The CHECK `WalletEntry_operation_priced` refuses
// such a row since migration 20261117210000_provider_ledger_stored, so it is dropped and added again NOT VALID around
// the insert, in one transaction: no other session sees the table without it. The table is locked first, before
// anything else is touched, so this transaction holds nothing another one could be waiting on while it waits.
//
// Once the CHECK is validated (slice P.3), adding it again NOT VALID would undo that on the test database; the specs
// that use this (the read-time fallback's and the backfill's) are rewritten or removed with it (slice P.4).

const kinds = PROVIDER_OPERATION_KINDS.map((kind) => `'${kind}'`).join(', ');

export async function entriesStoredBeforeTheCheck(prisma: PrismaClient, data: Prisma.WalletEntryCreateManyInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('LOCK TABLE "WalletEntry" IN ACCESS EXCLUSIVE MODE');
    await tx.$executeRawUnsafe('ALTER TABLE "WalletEntry" DROP CONSTRAINT "WalletEntry_operation_priced"');
    await tx.walletEntry.createMany({ data });
    await tx.$executeRawUnsafe(
      `ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_operation_priced" CHECK ("kind" NOT IN (${kinds}) OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID`,
    );
  });
}
