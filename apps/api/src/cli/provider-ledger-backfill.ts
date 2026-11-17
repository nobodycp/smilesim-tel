import 'reflect-metadata';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createPrismaClient } from '../db';
import type { Actor } from '../modules/access/types';
import { errorCode, logger } from '../modules/platform/log';
import { UnitOfWork, transaction } from '../modules/platform/unit-of-work';
import { ProviderAccountsService } from '../modules/providers/account/provider-accounts.service';
import { ProvidersRepository } from '../modules/providers/providers.repository';
import { PROVIDER_OPERATION_KINDS } from '../modules/wallets/provider-cost';
import { fillOperationColumns } from '../modules/wallets/wallet-ledger';
import { WalletsRepository } from '../modules/wallets/wallets.repository';
import { WalletsService } from '../modules/wallets/wallets.service';

// The provider ledger's backfill (ADR 0025, "Backfill"; plan 2026-11-17-database-scale, DB.5, slice P.2). Run once
// by hand, in the deploy window of release 1, after its migration and before any sale (writes stopped):
//
//   npm run build --workspace api
//   npm run provider-ledger-backfill --workspace api -- --dry-run     fills, proves, and rolls back
//   npm run provider-ledger-backfill --workspace api                  fills, proves, and commits only if equal
//
// For every operation entry written before release 1 (no `providerId`), it stores the provider and the cost that
// today's reading code gives it (`WalletsService.pricedOperations`: the stored cost, else the read-time fallback),
// so today's figures are frozen as they are, drift included. Rows written by release 1 already carry both and are
// left as they are: an entry's provider and cost are never rewritten.
//
// All of it is one transaction on the tool client (no statement limit), with the wallet entries locked against
// writes (SHARE ROW EXCLUSIVE: reads go on). Today's books are read first, through the services the screens use;
// then the columns are written; then, inside the same transaction, the stored columns are compared with today's
// books to the agora: each entry's provider and cost, each provider's purchases, balance and available, and each
// provider's ledger row by row (id, amount, balance after). Anything different rolls everything back.
//
// An entry today's books give to no provider (its package is gone and it has no line) cannot be filled: the
// command lists them and stops, changing nothing; the owner decides each.
//
// Exit code 0: committed (or, in a dry run, proven and rolled back). 1: unattributed entries or a difference;
// nothing was changed. 2: it could not run. It prints counts, ids, provider codes and money, never a whole number
// or the database driver's message.

const log = logger('ProviderLedgerBackfill');

/** Only these points of sale's entries and these providers' books: a spec on a shared database. Unset: everything. */
export type BackfillScope = { userIds: string[]; providerCodes: string[] };

export type BackfillOptions = { dryRun?: boolean; scope?: BackfillScope };

type Figures = { purchases: number; balance: number; available: number };
export type ProviderProof = { code: string; operations: number; ledgerRows: number; books: Figures; stored: Figures; equal: boolean };

export type BackfillRun = {
  dryRun: boolean;
  /** Operation entries read; of those, written now, and already carrying their provider (written by release 1). */
  entries: number;
  filled: number;
  alreadyStored: number;
  /** Entries today's books give to no provider: listed, and the run stops before writing. */
  unattributed: { id: string; kind: string; packageName: string; companyName: string; number: string }[];
  /** Entries whose stored provider or cost is not what today's books give them. */
  entryDifferences: { id: string; books: { providerId: string; cost: number }; stored: { providerId: string | null; cost: number | null } }[];
  providers: ProviderProof[];
  /** Ledger rows that differ, per provider: the first few. */
  ledgerDifferences: { code: string; books: unknown; stored: unknown }[];
  /** After the writes: operation entries still without a provider or a cost, and entries naming no existing provider. */
  unpriced: number;
  strangers: number;
  committed: boolean;
};

/** Thrown inside the transaction to roll it back once the run is written down. */
class RolledBack extends Error {}

/** The branch owner, as the providers screens are read: the books carry no viewer's figures. */
const READER: Actor = { id: '', loginName: 'provider-ledger-backfill', nickname: '', layer: 'branch', isBranchOwner: true, grants: [], operatorId: '', impersonating: false };

const lastFour = (value: string) => (value.length > 4 ? `…${value.slice(-4)}` : value);

/** Today's books, read through the services the screens use (their reading code is what is frozen). */
function todaysBooks(prisma: PrismaClient) {
  const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as never);
  uow.prismaClient = prisma;
  // Only the reading methods are called: `pricedOperations` needs the repository alone.
  const wallets = new WalletsService(uow, null as never, null as never, null as never, new WalletsRepository(uow));
  return { wallets, accounts: new ProviderAccountsService(uow, wallets, new ProvidersRepository(uow)) };
}

/**
 * Fills the operation entries' provider and cost, and proves the stored figures equal today's books before it
 * commits. `prisma` must be a client with two connections or more: the transaction holds one, today's books are
 * read on another (they see the committed rows, which the lock keeps as they are).
 */
export async function backfillProviderLedger(prisma: PrismaClient, options: BackfillOptions = {}): Promise<BackfillRun> {
  const scope = options.scope;
  const run: BackfillRun = { dryRun: Boolean(options.dryRun), entries: 0, filled: 0, alreadyStored: 0, unattributed: [], entryDifferences: [], providers: [], ledgerDifferences: [], unpriced: 0, strangers: 0, committed: false };
  const { wallets, accounts } = todaysBooks(prisma);
  const inScope = (row: { userId?: string }) => !scope || scope.userIds.includes(row.userId ?? '');
  try {
    await transaction(
      prisma,
      async (tx) => {
        // Today's books are read on another connection while this transaction waits: it may stay idle longer than
        // the 30 s a connection of the application may (`db.ts`).
        await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = 0`;
        await tx.$executeRaw`LOCK TABLE "WalletEntry" IN SHARE ROW EXCLUSIVE MODE`;
        const providers = await tx.provider.findMany({ select: { id: true, code: true, name: true } });
        const idOf = new Map(providers.map((row) => [row.code, row.id]));
        const chosen = providers.filter((row) => !scope || scope.providerCodes.includes(row.code));

        // 1. Today's books, before anything is written.
        const owners = new Map((await tx.walletEntry.findMany({ where: { kind: { in: PROVIDER_OPERATION_KINDS } }, select: { id: true, userId: true, providerId: true } })).map((row) => [row.id, row]));
        const priced = (await wallets.pricedOperations()).filter((row) => inScope(owners.get(row.id) ?? {}));
        const summaries = new Map((await accounts.summaries()).map((row) => [row.code, row]));
        const ledgers = new Map<string, Ledger>();
        for (const provider of chosen) ledgers.set(provider.code, await accounts.detail(READER, provider.code));
        run.entries = priced.length;
        run.unattributed = priced
          .filter((row) => !idOf.has(row.providerCode))
          .map((row) => ({ id: row.id, kind: row.kind, packageName: row.packageName, companyName: row.companyName, number: lastFour(row.msisdn) }));
        if (run.unattributed.length > 0) throw new RolledBack();

        // 2. The columns, for the entries written before release 1 only.
        const missing = priced.filter((row) => owners.get(row.id)?.providerId == null);
        run.alreadyStored = priced.length - missing.length;
        run.filled = await fillOperationColumns(tx, missing.map((row) => ({ id: row.id, providerId: idOf.get(row.providerCode) as string, cost: row.cost })));

        // 3. The proof, inside the same transaction: what is stored now against today's books.
        const stored = new Map(
          (await tx.walletEntry.findMany({ where: { id: { in: priced.map((row) => row.id) } }, select: { id: true, providerId: true, providerCost: true } })).map((row) => [row.id, row]),
        );
        for (const row of priced) {
          const kept = stored.get(row.id);
          const books = { providerId: idOf.get(row.providerCode) as string, cost: row.cost };
          if (!kept || kept.providerId !== books.providerId || kept.providerCost !== books.cost) run.entryDifferences.push({ id: row.id, books, stored: { providerId: kept?.providerId ?? null, cost: kept?.providerCost ?? null } });
        }
        await proveProviders(tx, chosen, summaries, ledgers, run);
        await countLeftovers(tx, scope, run);
        const proven = run.entryDifferences.length === 0 && run.providers.every((row) => row.equal) && run.unpriced === 0 && run.strangers === 0;
        if (!proven || run.dryRun) throw new RolledBack();
      },
      { maxWait: 10_000, timeout: 30 * 60_000 },
    );
    run.committed = true;
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  return run;
}

type Summary = Awaited<ReturnType<ProviderAccountsService['summaries']>>[number];
type Ledger = Awaited<ReturnType<ProviderAccountsService['detail']>>;

/**
 * Each provider's figures from the stored columns against today's books: purchases (an SQL sum), balance and
 * available (the books' payments, settlements, credit and held, which the backfill does not touch), and the ledger
 * row by row (id, amount, balance after) as far as the books' page goes.
 */
async function proveProviders(tx: Prisma.TransactionClient, chosen: { id: string; code: string }[], summaries: Map<string, Summary>, ledgers: Map<string, Ledger>, run: BackfillRun) {
  const sums = new Map(
    (await tx.$queryRaw<{ providerId: string; purchases: bigint; operations: bigint }[]>`
      SELECT "providerId", coalesce(sum("providerCost"), 0) AS purchases, count(*) AS operations FROM "WalletEntry"
      WHERE "providerId" IS NOT NULL AND "kind" IN (${Prisma.join(PROVIDER_OPERATION_KINDS)}) GROUP BY "providerId"`).map((row) => [row.providerId, row]),
  );
  for (const provider of chosen) {
    const summary = summaries.get(provider.code);
    const ledger = ledgers.get(provider.code);
    if (!summary || !ledger) continue;
    const purchases = Number(sums.get(provider.id)?.purchases ?? 0);
    const balance = summary.payments + summary.settlements - purchases;
    const proof: ProviderProof = {
      code: provider.code,
      operations: Number(sums.get(provider.id)?.operations ?? 0),
      ledgerRows: ledger.ledger.length,
      books: { purchases: summary.purchases, balance: summary.balance, available: summary.available },
      stored: { purchases, balance, available: balance + summary.creditLimit - summary.held },
      equal: false,
    };
    const rows = await storedLedger(tx, provider.id);
    const theirs = ledger.ledger.map((row) => [row.id, row.amount, row.balanceAfter]);
    const ours = rows.slice(0, theirs.length).map((row) => [row.id, row.amount, row.balanceAfter]);
    const differing = theirs.flatMap((row, index) => (JSON.stringify(row) === JSON.stringify(ours[index]) ? [] : [index]));
    for (const index of differing.slice(0, 5)) run.ledgerDifferences.push({ code: provider.code, books: theirs[index], stored: ours[index] ?? null });
    const sameLength = ledger.capped ? rows.length > theirs.length : rows.length === theirs.length;
    proof.equal = differing.length === 0 && sameLength && JSON.stringify(proof.books) === JSON.stringify(proof.stored);
    run.providers.push(proof);
  }
}

/** Operation entries still without a provider or a cost, and entries naming a provider that does not exist. */
async function countLeftovers(tx: Prisma.TransactionClient, scope: BackfillScope | undefined, run: BackfillRun) {
  const users = scope ? Prisma.sql`AND "userId" IN (${Prisma.join(scope.userIds)})` : Prisma.empty;
  const [row] = await tx.$queryRaw<{ unpriced: bigint; strangers: bigint }[]>`
    SELECT
      count(*) FILTER (WHERE "kind" IN (${Prisma.join(PROVIDER_OPERATION_KINDS)}) AND ("providerId" IS NULL OR "providerCost" IS NULL)) AS unpriced,
      count(*) FILTER (WHERE "providerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Provider" AS provider WHERE provider."id" = entry."providerId")) AS strangers
    FROM "WalletEntry" AS entry WHERE true ${users}`;
  run.unpriced = Number(row?.unpriced ?? 0);
  run.strangers = Number(row?.strangers ?? 0);
}

/** A provider's ledger from the stored columns: its priced operations and its entries, oldest first with the running balance, answered newest first. */
async function storedLedger(tx: Prisma.TransactionClient, providerId: string) {
  const [operations, entries] = await Promise.all([
    tx.walletEntry.findMany({ where: { providerId, kind: { in: PROVIDER_OPERATION_KINDS }, providerCost: { not: 0 } }, select: { id: true, createdAt: true, providerCost: true } }),
    tx.providerEntry.findMany({ where: { providerId }, select: { id: true, createdAt: true, amount: true } }),
  ]);
  const rows = [
    ...operations.map((row) => ({ id: row.id, at: row.createdAt, amount: -(row.providerCost ?? 0) })),
    ...entries.map((row) => ({ id: row.id, at: row.createdAt, amount: row.amount })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  let running = 0;
  return rows.map((row) => ({ ...row, balanceAfter: (running += row.amount) })).reverse();
}

/** The run in lines for the log. */
export function backfillLines(run: BackfillRun): string[] {
  const lines: string[] = [];
  if (run.unattributed.length > 0) {
    for (const row of run.unattributed) lines.push(`unattributed: entry ${row.id} (${row.kind}, package "${row.packageName}", company "${row.companyName}", number ${row.number})`);
    lines.push(`${run.unattributed.length} operation entr(ies) belong to no provider in today's books: decide each, then run this again. Nothing was changed.`);
    return lines;
  }
  lines.push(`operation entries: ${run.entries}; filled ${run.filled}; already stored ${run.alreadyStored}`);
  for (const row of run.providers) {
    const figures = (['purchases', 'balance', 'available'] as const).map((name) => `${name} ${row.books[name]} (books) / ${row.stored[name]} (stored)`).join(', ');
    lines.push(`provider ${row.code}: ${row.equal ? 'EQUAL' : 'DIFFERENT'}: ${figures}; ${row.operations} operation entr(ies); ${row.ledgerRows} ledger row(s) compared`);
  }
  for (const row of run.entryDifferences.slice(0, 20)) lines.push(`entry ${row.id}: books ${row.books.providerId} ${row.books.cost}, stored ${row.stored.providerId} ${row.stored.cost}`);
  for (const row of run.ledgerDifferences) lines.push(`ledger ${row.code}: books ${JSON.stringify(row.books)}, stored ${JSON.stringify(row.stored)}`);
  if (run.unpriced > 0) lines.push(`${run.unpriced} operation entr(ies) still carry no provider or no cost`);
  if (run.strangers > 0) lines.push(`${run.strangers} entr(ies) name a provider that does not exist`);
  const equal = run.entryDifferences.length === 0 && run.providers.every((row) => row.equal) && run.unpriced === 0 && run.strangers === 0;
  if (!equal) lines.push('the stored figures differ from today\'s books: everything was rolled back, nothing was changed');
  else if (run.dryRun) lines.push('equal to the agora; dry run: rolled back, nothing was changed');
  else lines.push(run.committed ? 'equal to the agora: committed' : 'not committed: nothing was changed');
  return lines;
}

/** Runs the backfill and answers the exit code. `argv` is the command line after the script's name. */
export async function run(argv: string[] = process.argv.slice(2), client?: PrismaClient): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  if (argv.some((arg) => arg !== '--dry-run')) {
    log.error('unknown argument: only --dry-run is accepted; nothing was read or changed');
    return 2;
  }
  const prisma = client ?? createPrismaClient('tool');
  try {
    const done = await backfillProviderLedger(prisma, { dryRun });
    const lines = backfillLines(done);
    const proven = done.unattributed.length === 0 && done.entryDifferences.length === 0 && done.providers.every((row) => row.equal) && done.unpriced === 0 && done.strangers === 0;
    for (const line of lines) (proven ? log.log : log.error).call(log, line);
    return proven && (done.committed || dryRun) ? 0 : 1;
  } catch (error) {
    log.error(`the backfill could not run (${errorCode(error)}); nothing was changed`);
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void run().then((code) => process.exit(code));
}
