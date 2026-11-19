import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { SALE_KINDS } from '../../pricing';
import { PROVIDER_OPERATION_KINDS } from '../provider-cost';

// Specs only. Wallet entries as they were stored before the provider ledger's first release (ADR 0025, P.1) and
// before the stored margins (ADR 0026, M.1): an operation's entry with no provider and, for some kinds, no cost; a
// sale's entry with its ladder and none of its margins, or with no ladder at all (spec F.3). The CHECKs
// `WalletEntry_operation_priced`, `WalletEntry_sale_margins` and `WalletEntry_sale_has_ladder` refuse such rows, so
// they are dropped and added again NOT VALID around the insert, in one transaction: no other session sees the table
// without them. The table is locked first, before anything else is touched, so this transaction holds nothing another
// one could be waiting on while it waits.
//
// The CHECKs are validated on the test database (migrations 20261117220100_provider_ledger_validate,
// 20261117230200_stored_margins_validate and 20261119100000_sale_has_ladder): a spec that writes such rows deletes
// them and calls `theCheckValidatedAgain` in its `afterAll`, so the database is left as the migrations left it.

const kinds = PROVIDER_OPERATION_KINDS.map((kind) => `'${kind}'`).join(', ');
const sales = Object.keys(SALE_KINDS).map((kind) => `'${kind}'`).join(', ');

export async function entriesStoredBeforeTheCheck(prisma: PrismaClient, data: Prisma.WalletEntryCreateManyInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('LOCK TABLE "WalletEntry" IN ACCESS EXCLUSIVE MODE');
    await tx.$executeRawUnsafe('ALTER TABLE "WalletEntry" DROP CONSTRAINT "WalletEntry_operation_priced"');
    await tx.$executeRawUnsafe('ALTER TABLE "WalletEntry" DROP CONSTRAINT "WalletEntry_sale_margins"');
    await tx.$executeRawUnsafe('ALTER TABLE "WalletEntry" DROP CONSTRAINT "WalletEntry_sale_has_ladder"');
    await tx.walletEntry.createMany({ data });
    await tx.$executeRawUnsafe(
      `ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_operation_priced" CHECK ("kind" NOT IN (${kinds}) OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID`,
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_sale_margins" CHECK ("ladder" IS NULL OR ("chainPosId" IS NOT NULL AND "branchMargin" IS NOT NULL)) NOT VALID',
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_sale_has_ladder" CHECK (NOT ("kind" IN (${sales}) AND "amount" < 0) OR "ladder" IS NOT NULL) NOT VALID`,
    );
  });
}

/** Validates the CHECKs again once the spec's old-form rows are gone (it fails, loudly, if one is left). */
export async function theCheckValidatedAgain(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_operation_priced"');
  await prisma.$executeRawUnsafe('ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_sale_margins"');
  await prisma.$executeRawUnsafe('ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_sale_has_ladder"');
}
