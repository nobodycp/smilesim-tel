import 'reflect-metadata';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createPrismaClient } from '../db';
import { errorCode, logger } from '../modules/platform/log';
import { transaction } from '../modules/platform/unit-of-work';
import { DISCONNECT_FEE, SALE_KINDS, heldEsimFee, lineTermsOf, packageActivationCost, providerBranchCost, type PackagePriceRow } from '../modules/postpaid/pricing';
import { esimPriceOf } from '../modules/postpaid/catalog';
import { PROVIDER_RELEASED_NOTE } from '../modules/platform/stored-text';
import { PREPAID_KINDS } from '../modules/postpaid/sales/line-pricing';
import { daysOf, periodsAt, periodsCost, settleDisconnect, windowMonthsOf, type OpenPeriod, type PrepaidRow } from '../modules/postpaid/sales/rules/periods';
import { PROVIDER_OPERATION_KINDS } from '../modules/wallets/provider-cost';
import { markProviderLosses, rewriteOperationColumns, writeGivenBack, type MarkedEntry, type RepricedEntry } from '../modules/wallets/wallet-ledger';

// The provider ledger's backfill (ADR 0025, "Amendment"; plan 2026-11-17-database-scale, DB.5, slice P.4b). Run once
// by hand on the deployed release, after its migrations, with writes stopped (docs/handover/technical-operations-ar.md
// §13):
//
//   node dist/cli/provider-ledger-backfill.js --dry-run              writes, prints, and rolls back
//   node dist/cli/provider-ledger-backfill.js                        writes, prints, validates the CHECK, commits
//   node dist/cli/provider-ledger-backfill.js --leave-unresolved     the same, leaving the entries it cannot resolve
//
// For every operation entry (a kind of `PROVIDER_OPERATION_KINDS`) it stores the provider and the cost the writers
// store today:
//
// - The provider is the provider of the entry's line's package (owner's answer 2: an operation belongs to the
//   provider of its package at the time; a line never moves to another provider's package, `switchOnto` refuses it,
//   so its package's provider is the one it had at every operation). An entry whose stored provider differs (the
//   release-1 backfill's name matching gave some to another provider with a package of the same name) is moved.
//   An entry with no line keeps the provider it stored; with no line and no provider it cannot be attributed.
// - A cost already stored is kept. A missing one is filled per kind (`costOf` below), from the entry's own record of
//   the day first, then the line's terms, then the package.
// - A disconnect stored in the old form (used share + fee, before slice P.6) is corrected to minus what the provider
//   gives back: the stored figure less the cost of the periods open at its own time (`correctedDisconnect` below).
//
// This rewrites stored ledger columns of old rows. That is allowed only because the system runs on trial data before
// launch and the owner's standing rule keeps nothing in an old form (ADR 0025, amendment; financial-invariants.md).
// After launch an entry's provider and cost are never updated, and this command is not run again.
//
// P.7 (spec "Paid at the provider, not charged to the point of sale (DB.5 P.7)"): in the same transaction, after the
// above, every old operation the provider was paid for and the point of sale was not charged for is marked:
//
// - an activation or renewal that moved 0 (sold at 0): an activation that stored cost 0 is re-priced by the activation
//   rule of `costOf`; each one whose cost is then above 0 is marked `priced_zero`, its branch margin minus the cost;
// - an approved `release-after-success` (found from its decision event, its operation and its task) that has no
//   entry gets one, dated at the approval: an activation moving 0 on the point of sale's wallet, the package's cost
//   now (no older figure is kept), marked `given_back`.
//
// One transaction on the tool client (no statement limit), with the wallet entries locked against writes (SHARE ROW
// EXCLUSIVE: reads go on). An entry it cannot resolve is listed and the run stops before writing, unless
// `--leave-unresolved` is passed: those entries then stay as they are (in no provider's books, as the books read
// them already), everything else is written, and the CHECK is left NOT VALID (it still checks every new row). When
// no stored row breaks the CHECK at the end, it is validated in the same transaction. A second run changes nothing.
// An old sale it writes that has no ladder (the stored-margins backfill could not build one: it lists it) would break
// the CHECK `WalletEntry_sale_has_ladder` (spec F.3; PostgreSQL checks every CHECK, NOT VALID ones too, on a row an
// UPDATE writes): that CHECK is then dropped and added again NOT VALID around the write, in this transaction, and the
// run says so; it stays NOT VALID until those sales are decided.
//
// Exit code 0: committed (or, in a dry run, rolled back). 1: unresolved entries and no flag; nothing was changed.
// 2: it could not run; nothing was changed. It prints ids, kinds, provider codes and money, never a whole number or
// the database driver's message.

const log = logger('ProviderLedgerBackfill');

const CHECK = 'WalletEntry_operation_priced';
const SALE_CHECK = 'WalletEntry_sale_has_ladder';
const SALES = Object.keys(SALE_KINDS);

/** Only these points of sale's entries: a spec on a shared database. Unset: every entry. */
export type BackfillScope = { userIds: string[] };

export type BackfillOptions = { dryRun?: boolean; leaveUnresolved?: boolean; scope?: BackfillScope };

/** One entry the run changed, and why. */
export type Change = { id: string; kind: string; from: { provider: string | null; cost: number | null }; to: { provider: string; cost: number }; source: string };

export type BackfillRun = {
  dryRun: boolean;
  entries: number;
  /** Entries whose provider was empty and is now filled, moved to another provider, or whose cost was filled. */
  attributed: Change[];
  moved: Change[];
  priced: Change[];
  /** Entries it could not resolve, and why; with `--leave-unresolved` they are left as they are. */
  unresolved: { id: string; kind: string; reason: string }[];
  /** Unresolved entries and no `--leave-unresolved`: nothing was written. */
  stopped: boolean;
  written: number;
  /** P.7: entries marked as the branch's loss (priced 0), and the given-back activations written. */
  losses: LossChange[];
  givenBack: GivenBack[];
  /** P.7: operations sold at 0 whose cost cannot be found: left unmarked. */
  lossesLeft: { id: string; kind: string; reason: string }[];
  /** Per provider code: purchases before and after. */
  purchases: { code: string; before: number; after: number }[];
  /** Old sales written that keep no ladder: the CHECK `WalletEntry_sale_has_ladder` was lifted around the write (F.3). */
  liftedSaleCheck: number;
  /** After the writes, in the whole table: operation entries without a provider or a cost. */
  breaking: number;
  validated: boolean;
  committed: boolean;
};

/** An entry marked `priced_zero` by the P.7 pass. */
export type LossChange = { id: string; kind: string; provider: string; from: number | null; cost: number; source: string };
/** A given-back activation the P.7 pass wrote. */
export type GivenBack = { id: string; taskId: string; provider: string; cost: number; at: Date };

/** Thrown inside the transaction to roll it back once the run is written down. */
class RolledBack extends Error {}

type Packaged = PackagePriceRow & { providerId: string };
type Entry = {
  id: string;
  kind: string;
  amount?: number;
  lineId: string | null;
  providerId: string | null;
  providerCost: number | null;
  periodCost: number | null;
  esimPrice: number | null;
  ladder: Prisma.JsonValue;
  createdAt: Date;
  line: { id: string; endsAt: Date; terms: Prisma.JsonValue; package: Packaged } | null;
};
type Prepaid = PrepaidRow & { lineId: string | null; createdAt: Date };

const RENEWAL_KINDS = new Set(['charge', 'extend', 'reactivate']);

/** The branch's cost on the entry's own price chain (the ladder kept at the sale): the chain's top is the branch. */
function ladderBranchCost(ladder: Prisma.JsonValue): number | null {
  if (!ladder || typeof ladder !== 'object' || Array.isArray(ladder)) return null;
  const { chain, costs } = ladder as { chain?: unknown; costs?: unknown };
  if (!Array.isArray(chain) || chain.length === 0 || !costs || typeof costs !== 'object') return null;
  const value = (costs as Record<string, unknown>)[String(chain[chain.length - 1])];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** The line's terms as a disconnect reads them, or null when they cannot be read. */
function termsOf(line: NonNullable<Entry['line']>) {
  try {
    return lineTermsOf(line.terms, line.package);
  } catch {
    return null;
  }
}

/**
 * The cost to store on an entry that stored none, by the rule its writer uses today, and where the figure came from;
 * or the reason it cannot be found.
 *
 * - `activate`: the period's cost kept on the entry (`periodCost`, the subscription's branch cost written by the
 *   sale), else the branch's cost on the entry's ladder, else the line's subscription branch cost (stamped at the
 *   sale; a transfer re-stamps it from the prices of its day), else the package's; plus the eSIM fee kept on the entry.
 * - `charge`, `extend`, `reactivate`: the same with the renewal branch cost.
 * - `disconnect`: the settlement's provider cost, worked out at the entry's own time from the line's prepaid entries
 *   written before it (`settleDisconnect`); no open period: 0, as the writer records it.
 * - `switch`: none. Its cost is the quoted difference of the day, which no stored row keeps.
 * - `esim`: the eSIM fee kept on the entry. Every other kind: 0.
 */
function costOf(entry: Entry, prepaid: Prepaid[]): { cost: number; source: string } | { reason: string } {
  const kind = entry.kind;
  if (kind === 'activate' || RENEWAL_KINDS.has(kind)) {
    const fee = kind === 'activate' ? entry.esimPrice ?? 0 : 0;
    const withFee = (cost: number, source: string) => ({ cost: cost + fee, source: fee ? `${source} + the eSIM fee kept on the entry` : source });
    if (entry.periodCost !== null) return withFee(entry.periodCost, 'the period cost kept on the entry');
    const laddered = ladderBranchCost(entry.ladder);
    if (laddered !== null) return withFee(laddered, "the branch's cost on the entry's ladder");
    if (!entry.line) return { reason: 'no cost kept on the entry and no line' };
    const terms = entry.line.terms as Parameters<typeof providerBranchCost>[1];
    const saved = (RENEWAL_KINDS.has(kind) ? terms?.renewal : terms?.subscription)?.branchCost;
    return withFee(providerBranchCost(kind, terms, entry.line.package), typeof saved === 'number' ? "the line's terms" : "the package's price");
  }
  if (kind === 'disconnect') {
    const open = periodsAtDisconnect(entry, prepaid);
    if ('reason' in open) return open;
    const settled = settleDisconnect(open.periods, open.branchCostOf);
    return settled ? { cost: settled.providerCost, source: 'the disconnect settlement at its own time' } : { cost: 0, source: 'no open period at the disconnect' };
  }
  if (kind === 'switch') return { reason: 'a switch keeps no record of its quoted difference' };
  if (kind === 'esim') return { cost: entry.esimPrice ?? 0, source: 'the eSIM fee kept on the entry' };
  return { cost: 0, source: 'a kind the provider does not price' };
}

/** The line's paid periods open at the disconnect's own time, read from the prepaid entries written before it, as the writer read them. */
function periodsAtDisconnect(entry: Entry, prepaid: Prepaid[]): { periods: OpenPeriod[]; branchCostOf: (renewal: boolean) => number } | { reason: string } {
  if (!entry.line) return { reason: 'no line to find the disconnected period on' };
  const terms = termsOf(entry.line);
  if (!terms) return { reason: "the line's terms cannot be read" };
  const rows = prepaid.filter((row) => row.lineId === entry.line?.id && row.createdAt.getTime() < entry.createdAt.getTime());
  const { periods } = periodsAt(entry.createdAt, rows, entry.line.endsAt, daysOf(windowMonthsOf(terms)), (renewal) => (renewal ? terms.renewal.posPrice : terms.subscription.posPrice));
  return { periods, branchCostOf: (renewal) => (renewal ? terms.renewal.branchCost : terms.subscription.branchCost) };
}

/**
 * A disconnect stored before slice P.6 kept the used share plus the fee (always above the fee: a started day counts
 * as used); one stored since keeps used + fee − the open periods' cost (never above the fee: the used share is at
 * most the running period's cost). So a stored figure above the fee is the old form, and the new one is that figure
 * less the cost of the periods open at the disconnect (the used share is the writer's own, kept in the figure).
 * Null: already in the new form. A reason: the periods cannot be found, or they cost less than the used share.
 */
function correctedDisconnect(entry: Entry, prepaid: Prepaid[]): { cost: number; source: string } | { reason: string } | null {
  if (entry.kind !== 'disconnect' || entry.providerCost === null || entry.providerCost <= DISCONNECT_FEE) return null;
  const open = periodsAtDisconnect(entry, prepaid);
  if ('reason' in open) return open;
  const paid = periodsCost(open.periods, open.branchCostOf);
  if (paid === 0) return { reason: 'a disconnect in the old form with no open period to give back' };
  const cost = entry.providerCost - paid;
  if (cost > DISCONNECT_FEE) return { reason: "a disconnect in the old form whose used share exceeds its periods' cost" };
  return { cost, source: `the provider gives back the open periods' cost ${paid} (slice P.6)` };
}

async function purchasesByProvider(tx: Prisma.TransactionClient, scope: BackfillScope | undefined): Promise<Map<string, number>> {
  const users = scope ? Prisma.sql`AND "userId" IN (${Prisma.join(scope.userIds)})` : Prisma.empty;
  const rows = await tx.$queryRaw<{ providerId: string; purchases: bigint }[]>`
    SELECT "providerId", coalesce(sum("providerCost"), 0) AS purchases FROM "WalletEntry"
    WHERE "providerId" IS NOT NULL AND "kind" IN (${Prisma.join(PROVIDER_OPERATION_KINDS)}) ${users} GROUP BY "providerId"`;
  return new Map(rows.map((row) => [row.providerId, Number(row.purchases)]));
}

/** Writes the provider and cost of every operation entry (in `scope`), validates the CHECK when it holds, and commits unless asked not to. */
export async function backfillProviderLedger(prisma: PrismaClient, options: BackfillOptions = {}): Promise<BackfillRun> {
  const scope = options.scope;
  const run: BackfillRun = { dryRun: Boolean(options.dryRun), entries: 0, attributed: [], moved: [], priced: [], unresolved: [], stopped: false, written: 0, losses: [], givenBack: [], lossesLeft: [], purchases: [], liftedSaleCheck: 0, breaking: 0, validated: false, committed: false };
  try {
    await transaction(
      prisma,
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "WalletEntry" IN SHARE ROW EXCLUSIVE MODE`;
        const codes = new Map((await tx.provider.findMany({ select: { id: true, code: true } })).map((row) => [row.id, row.code]));
        const code = (id: string | null) => (id === null ? null : codes.get(id) ?? id);
        const entries: Entry[] = await tx.walletEntry.findMany({
          where: { kind: { in: PROVIDER_OPERATION_KINDS }, ...(scope ? { userId: { in: scope.userIds } } : {}) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true, kind: true, amount: true, lineId: true, providerId: true, providerCost: true, periodCost: true, esimPrice: true, ladder: true, createdAt: true,
            line: { select: { id: true, endsAt: true, terms: true, package: { include: { company: { select: { code: true } }, provider: { select: { code: true } } } } } },
          },
        });
        const disconnected = [...new Set(entries.filter((row) => row.kind === 'disconnect' && row.lineId).map((row) => row.lineId as string))];
        const prepaid: Prepaid[] = disconnected.length
          ? await tx.walletEntry.findMany({
              where: { lineId: { in: disconnected }, kind: { in: PREPAID_KINDS } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { lineId: true, kind: true, packagePrice: true, periodDays: true, periodEndsAt: true, periodCost: true, createdAt: true },
            })
          : [];
        const before = await purchasesByProvider(tx, scope);
        run.entries = entries.length;

        const writes: RepricedEntry[] = [];
        for (const entry of entries) {
          const provider = entry.line?.package.providerId ?? entry.providerId;
          if (!provider) {
            run.unresolved.push({ id: entry.id, kind: entry.kind, reason: 'no line and no provider stored' });
            continue;
          }
          const priced = entry.providerCost === null ? costOf(entry, prepaid) : correctedDisconnect(entry, prepaid) ?? { cost: entry.providerCost, source: 'kept' };
          if ('reason' in priced) {
            run.unresolved.push({ id: entry.id, kind: entry.kind, reason: priced.reason });
            continue;
          }
          if (provider === entry.providerId && priced.cost === entry.providerCost) continue;
          const change: Change = { id: entry.id, kind: entry.kind, from: { provider: code(entry.providerId), cost: entry.providerCost }, to: { provider: code(provider) as string, cost: priced.cost }, source: priced.source };
          if (entry.providerId === null) run.attributed.push(change);
          else if (provider !== entry.providerId) run.moved.push(change);
          if (priced.cost !== entry.providerCost) run.priced.push(change);
          writes.push({ id: entry.id, providerId: provider, cost: priced.cost });
        }
        if (run.unresolved.length > 0 && !options.leaveUnresolved) {
          run.stopped = true;
          throw new RolledBack();
        }

        run.written = await writeAroundSaleCheck(tx, run, entries, writes);
        run.written += await markOldLosses(tx, scope, code, run);
        run.written += await writeOldGivenBack(tx, scope, code, run);
        const after = await purchasesByProvider(tx, scope);
        run.purchases = [...new Set([...before.keys(), ...after.keys()])]
          .map((id) => ({ code: code(id) as string, before: before.get(id) ?? 0, after: after.get(id) ?? 0 }))
          .sort((a, b) => a.code.localeCompare(b.code));

        const [left] = await tx.$queryRaw<{ breaking: bigint }[]>`
          SELECT count(*) AS breaking FROM "WalletEntry"
          WHERE "kind" IN (${Prisma.join(PROVIDER_OPERATION_KINDS)}) AND ("providerId" IS NULL OR "providerCost" IS NULL)`;
        run.breaking = Number(left?.breaking ?? 0);
        if (run.breaking === 0) await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "${CHECK}"`);
        const [state] = await tx.$queryRaw<{ convalidated: boolean }[]>`SELECT convalidated FROM pg_constraint WHERE conname = ${CHECK}`;
        run.validated = Boolean(state?.convalidated);
        if (run.dryRun) throw new RolledBack();
      },
      { maxWait: 10_000, timeout: 30 * 60_000 },
    );
    run.committed = true;
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  return run;
}

/**
 * Writes the providers and costs, around the CHECK `WalletEntry_sale_has_ladder` when an old sale among the writes
 * keeps no ladder (spec F.3): PostgreSQL checks a NOT VALID CHECK too on a row an UPDATE writes. Dropped and added
 * again NOT VALID in the caller's transaction; `run.liftedSaleCheck` counts those sales.
 */
async function writeAroundSaleCheck(tx: Prisma.TransactionClient, run: BackfillRun, entries: Entry[], writes: RepricedEntry[]): Promise<number> {
  const unladdered = new Set(entries.filter((row) => SALES.includes(row.kind) && (row.amount ?? 0) < 0 && row.ladder === null).map((row) => row.id));
  run.liftedSaleCheck = writes.filter((row) => unladdered.has(row.id)).length;
  if (run.liftedSaleCheck === 0) return rewriteOperationColumns(tx, writes);
  await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" DROP CONSTRAINT "${SALE_CHECK}"`);
  const written = await rewriteOperationColumns(tx, writes);
  const kinds = SALES.map((kind) => `'${kind}'`).join(', ');
  await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" ADD CONSTRAINT "${SALE_CHECK}" CHECK (NOT ("kind" IN (${kinds}) AND "amount" < 0) OR "ladder" IS NOT NULL) NOT VALID`);
  return written;
}

/** The kinds a sale at 0 is marked on (`operationColumns`): an activation and the renewals, never a switch. */
const PRICED_ZERO_KINDS = ['activate', 'charge', 'extend', 'reactivate'];

/** P.7: the operations sold at 0, re-priced where an activation stored 0, and marked `priced_zero` when they cost more than 0. */
async function markOldLosses(tx: Prisma.TransactionClient, scope: BackfillScope | undefined, code: (id: string | null) => string | null, run: BackfillRun): Promise<number> {
  const rows: (Entry & { amount: number })[] = await tx.walletEntry.findMany({
    where: { kind: { in: PRICED_ZERO_KINDS }, amount: 0, providerLoss: null, providerId: { not: null }, ...(scope ? { userId: { in: scope.userIds } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, kind: true, amount: true, lineId: true, providerId: true, providerCost: true, periodCost: true, esimPrice: true, ladder: true, createdAt: true,
      line: { select: { id: true, endsAt: true, terms: true, package: { include: { company: { select: { code: true } }, provider: { select: { code: true } } } } } },
    },
  });
  const marks: MarkedEntry[] = [];
  for (const row of rows) {
    const priced = row.kind === 'activate' && (row.providerCost ?? 0) === 0 ? costOf({ ...row, providerCost: null }, []) : { cost: row.providerCost ?? 0, source: 'kept' };
    if ('reason' in priced) {
      run.lossesLeft.push({ id: row.id, kind: row.kind, reason: priced.reason });
      continue;
    }
    if (priced.cost <= 0) continue;
    marks.push({ id: row.id, cost: priced.cost, loss: 'priced_zero' });
    run.losses.push({ id: row.id, kind: row.kind, provider: code(row.providerId) as string, from: row.providerCost, cost: priced.cost, source: priced.source });
  }
  return markProviderLosses(tx, marks);
}

/** P.7: the approved releases after the provider's success that wrote no entry, written now, dated at the approval. */
async function writeOldGivenBack(tx: Prisma.TransactionClient, scope: BackfillScope | undefined, code: (id: string | null) => string | null, run: BackfillRun): Promise<number> {
  const approvals = await tx.providerDecisionEvent.findMany({
    where: { type: 'approved', decision: 'release-after-success', operation: { task: scope ? { posId: { in: scope.userIds } } : { isNot: null } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { accountId: true, createdAt: true, operation: { select: { resultMsisdn: true, task: { select: { id: true, posId: true, packageId: true, esim: true, msisdn: true, unitPrice: true, posDelta: true } } } } },
  });
  let written = 0;
  for (const approval of approvals) {
    const task = approval.operation.task;
    if (!task) continue;
    const pkg = await tx.postpaidPackage.findUniqueOrThrow({ where: { id: task.packageId }, include: { company: true, provider: true } });
    const msisdn = approval.operation.resultMsisdn ?? task.msisdn ?? '';
    // Already recorded (by the approval since P.7, or by an earlier run): a number given back once for that package,
    // charged to the point of sale later or not (P.9).
    const recorded = await tx.walletEntry.findFirst({ where: { userId: task.posId, kind: 'activate', providerLoss: { in: ['given_back', 'charged_later'] }, msisdn, packageName: pkg.name }, select: { id: true } });
    if (recorded) continue;
    const before = await tx.walletEntry.findFirst({ where: { userId: task.posId, createdAt: { lte: approval.createdAt } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { balanceAfter: true } });
    const after = before ? null : await tx.walletEntry.findFirst({ where: { userId: task.posId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { balanceAfter: true, amount: true } });
    const wallet = before || after ? null : await tx.wallet.findUnique({ where: { userId: task.posId }, select: { balance: true } });
    const balanceAfter = before?.balanceAfter ?? (after ? after.balanceAfter - after.amount : wallet?.balance ?? 0);
    const cost = packageActivationCost(pkg.branchCost, task.esim, esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company ?? undefined }).price);
    // The package price and, for an eSIM, the fee: what the task held and gave back, which charging it later takes (P.9).
    const packagePrice = task.unitPrice ?? pkg.posPrice;
    const id = await writeGivenBack(tx, {
      userId: task.posId, actorId: approval.accountId, at: approval.createdAt, balanceAfter, note: PROVIDER_RELEASED_NOTE,
      sale: {
        msisdn, lineId: '', companyName: pkg.company?.name ?? '', packageName: pkg.name, packagePrice, providerId: pkg.providerId, providerCost: cost, providerLoss: 'given_back',
        ...(task.esim ? { esimPrice: heldEsimFee(task.posDelta, packagePrice) } : {}),
      },
    });
    run.givenBack.push({ id, taskId: task.id, provider: code(pkg.providerId) as string, cost, at: approval.createdAt });
    written += 1;
  }
  return written;
}

const money = (value: number | null) => (value === null ? 'none' : String(value));

/** The run in lines for the log. */
export function backfillLines(run: BackfillRun): string[] {
  const lines: string[] = [];
  for (const row of run.unresolved) lines.push(`unresolved: entry ${row.id} (${row.kind}): ${row.reason}`);
  if (run.stopped) {
    lines.push(`${run.unresolved.length} operation entr(ies) cannot be resolved: decide each, or run again with --leave-unresolved to leave them as they are. Nothing was changed.`);
    return lines;
  }
  lines.push(`operation entries: ${run.entries}; provider filled ${run.attributed.length}; moved ${run.moved.length}; cost changed ${run.priced.length}; rows written ${run.written}; left unresolved ${run.unresolved.length}`);
  for (const row of run.moved) lines.push(`moved: entry ${row.id} (${row.kind}) ${row.from.provider} -> ${row.to.provider}`);
  for (const row of run.attributed) lines.push(`provider filled: entry ${row.id} (${row.kind}) ${row.to.provider}`);
  for (const row of run.priced) lines.push(`cost: entry ${row.id} (${row.kind}, ${row.to.provider}) ${money(row.from.cost)} -> ${row.to.cost} (${row.source})`);
  lines.push(`P.7: marked priced_zero ${run.losses.length}; given back written ${run.givenBack.length}; sold at 0 left unmarked ${run.lossesLeft.length}`);
  for (const row of run.losses) lines.push(`priced_zero: entry ${row.id} (${row.kind}, ${row.provider}) cost ${money(row.from)} -> ${row.cost} (${row.source})`);
  for (const row of run.givenBack) lines.push(`given_back: entry ${row.id} for task ${row.taskId} (${row.provider}) cost ${row.cost} at ${row.at.toISOString()} (the package's cost now)`);
  for (const row of run.lossesLeft) lines.push(`sold at 0, left unmarked: entry ${row.id} (${row.kind}): ${row.reason}`);
  for (const row of run.purchases) lines.push(`provider ${row.code}: purchases ${row.before} -> ${row.after}`);
  if (run.liftedSaleCheck > 0) {
    lines.push(`check ${SALE_CHECK}: lifted around ${run.liftedSaleCheck} old sale(s) without a ladder and added again NOT VALID (stored-margins-backfill lists them under "no ladder")`);
  }
  lines.push(
    run.validated
      ? `check ${CHECK}: validated`
      : `check ${CHECK}: left NOT VALID, ${run.breaking} operation entr(ies) without a provider or a cost (new rows are still checked)`,
  );
  lines.push(run.dryRun ? 'dry run: rolled back, nothing was changed' : run.committed ? 'committed' : 'not committed: nothing was changed');
  return lines;
}

const FLAGS = new Set(['--dry-run', '--leave-unresolved']);

/** Runs the backfill and answers the exit code. `argv` is the command line after the script's name. */
export async function run(argv: string[] = process.argv.slice(2), client?: PrismaClient): Promise<number> {
  if (argv.some((arg) => !FLAGS.has(arg))) {
    log.error('unknown argument: only --dry-run and --leave-unresolved are accepted; nothing was read or changed');
    return 2;
  }
  const prisma = client ?? createPrismaClient('tool');
  try {
    const done = await backfillProviderLedger(prisma, { dryRun: argv.includes('--dry-run'), leaveUnresolved: argv.includes('--leave-unresolved') });
    for (const line of backfillLines(done)) (done.stopped ? log.error : log.log).call(log, line);
    return done.stopped ? 1 : 0;
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
