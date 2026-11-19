import 'reflect-metadata';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createPrismaClient } from '../db';
import { errorCode, logger } from '../modules/platform/log';
import { transaction } from '../modules/platform/unit-of-work';
import { REFUND_KINDS, SALE_KINDS, ladderOf, refundLadder, type Ladder, type SellRow, type TermRow } from '../modules/pricing';
import { PROVIDER_OPERATION_KINDS } from '../modules/wallets/provider-cost';
import { chainIdsOf, marginBreaks, marginColumns, type ChainIds } from '../modules/wallets/stored-margins';
import { rewriteMarginColumns, type MarginedEntry } from '../modules/wallets/wallet-ledger';

// The stored margins' backfill (ADR 0026, amendment; plan 2026-11-17-database-scale, DB.12, slice M.2). Run once by
// hand on the deployed release, after its migrations, with writes stopped, before `provider-ledger-backfill`
// (docs/handover/technical-operations-ar.md §13):
//
//   node dist/cli/stored-margins-backfill.js --dry-run     writes, prints, checks, and rolls back
//   node dist/cli/stored-margins-backfill.js               writes, prints, checks, validates the CHECK, commits
//   node dist/cli/stored-margins-backfill.js --check       reads only: the invariant over every entry, and nothing else
//
// For every sale entry (a kind of `SALE_KINDS`, a negative amount, a line) and refund entry (`REFUND_KINDS`, a
// positive amount, a line) it stores the chain by layer and each layer's margin, `marginOf` of the entry's ladder:
//
// - An entry that kept its ladder: from that ladder. Its accounts' layers name the columns (a layer never changes).
// - A sale without a kept ladder (written before ladders were kept): the ladder is built once, now, and stored with
//   it, so every row has its source (the owner's answer 2: an old sale is recorded at its time and no later price
//   moves it; the backfill fixes it once). Built as the read-time code built it (`laddersOf`, deleted with the old
//   reads), today's prices with what the point of sale paid, on the path **at the time of the sale** (the owner's
//   answer 1: the profit belongs to the accounts of the chain at the time): an account moved since (a point of sale
//   under another agent, an agent under another main agent) is put back under the parent it had then, read from the
//   transfer notices (`transfer.out`, written by every move with its time). Each is printed, and so is every one whose
//   path at the time differs from today's.
// - A refund without a kept ladder: its line's last sale before it, scaled by the part given back (`refundLadder`),
//   as the read-time code and `WalletLedger.refundOf` do; it stores that sale's accounts.
// - An entry whose ladder cannot be built (no line terms, no package, no path) stays without one, as the reads
//   already count it (0); each is printed.
//
// This rewrites old rows. That is allowed only because the system runs on trial data before launch and the owner's
// standing rule keeps nothing in an old form (ADR 0026, amendment; financial-invariants.md). After launch an entry's
// margins are never updated, and this command is not run again.
//
// One transaction on the tool client (no statement limit), with the wallet entries locked against writes (SHARE ROW
// EXCLUSIVE: reads go on). A chain that holds two accounts of one layer cannot be stored by layer: it is listed and
// the run stops before writing (exit 1); the ADR's share table would then replace the columns. An old operation row
// that has no provider yet (`provider-ledger-backfill` has not run) would make PostgreSQL refuse the update by the
// CHECK `WalletEntry_operation_priced` (a CHECK applies to every row an UPDATE writes, NOT VALID or not); that CHECK is
// then dropped and added again NOT VALID around the writes, in this transaction (it is NOT VALID while such rows exist,
// so nothing is lost), and the line says so. After the writes the invariant is checked in Node over every entry of the
// table (in `scope`): a break rolls everything back (exit 2). When no stored row breaks the CHECK
// `WalletEntry_sale_margins`, it is validated. A second run writes nothing.
//
// Exit code 0: committed (or, in a dry run, rolled back; or `--check` found no break). 1: a chain it cannot store, or
// `--check` found a break; nothing was changed. 2: it could not run; nothing was changed. It prints ids, kinds,
// logins and money, never the database driver's message.

const log = logger('StoredMarginsBackfill');

const CHECK = 'WalletEntry_sale_margins';
const PROVIDER_CHECK = 'WalletEntry_operation_priced';

/** Only these points of sale's entries: a spec on a shared database. Unset: every entry. */
export type BackfillScope = { userIds: string[] };

export type BackfillOptions = { dryRun?: boolean; scope?: BackfillScope };

/** One entry and what was stored on it, as the run prints it. */
export type Stored = {
  id: string;
  kind: string;
  at: string;
  /** Where its ladder came from. */
  source: 'kept' | 'rebuilt' | 'rebuilt from its sale';
  chain: string[];
  margins: { pos: number; agent: number | null; mainAgent: number | null; branch: number };
  /** The logins of today's path, when the path at its time differs. */
  movedFrom?: string[];
};

export type BackfillRun = {
  dryRun: boolean;
  sales: number;
  refunds: number;
  /** Entries written (a kept ladder given its columns, or a ladder built and stored). */
  written: number;
  stored: Stored[];
  /** Sale or refund entries left without a ladder, and why. */
  without: { id: string; kind: string; reason: string }[];
  /** Chains that cannot be stored by layer: the run stops before writing. */
  unresolved: { id: string; kind: string; reason: string }[];
  stopped: boolean;
  /** Old operation rows with no provider among the written ones: the provider ledger's CHECK was lifted around them. */
  liftedProviderCheck: number;
  /** Per account: what the stored margins add up to, by the layer it holds in the chains. */
  totals: { layer: string; login: string; margin: number }[];
  /** After the writes: entries of the table (in scope) that break the invariant. */
  breaks: { id: string; reason: string }[];
  /** After the writes, in the whole table: entries with a ladder and without their point of sale or branch margin. */
  breaking: number;
  validated: boolean;
  committed: boolean;
};

/** Thrown inside the transaction to roll it back once the run is written down. */
class RolledBack extends Error {}

type Account = { id: string; loginName: string; layer: string; parentId: string | null; deniedOps: string };
type Entry = {
  id: string;
  userId: string;
  kind: string;
  lineId: string | null;
  packagePrice: number | null;
  amount: number;
  ladder: Prisma.JsonValue;
  createdAt: Date;
  chainPosId: string | null;
  chainAgentId: string | null;
  chainMainAgentId: string | null;
  posMargin: number | null;
  agentMargin: number | null;
  mainAgentMargin: number | null;
  branchMargin: number | null;
  providerId: string | null;
  providerCost: number | null;
};

const ENTRY_COLUMNS = {
  id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true,
  chainPosId: true, chainAgentId: true, chainMainAgentId: true, posMargin: true, agentMargin: true, mainAgentMargin: true, branchMargin: true,
  providerId: true, providerCost: true,
} as const;

const SALES = Object.keys(SALE_KINDS);
const REFUNDS = [...REFUND_KINDS];
const PROVIDER_KINDS = new Set(PROVIDER_OPERATION_KINDS);

/**
 * Each account's parent at an instant: today's, unless the account was moved after it, in which case the parent it
 * was moved away from by its first move after that instant (the `transfer.out` notice is written to that parent).
 */
function parentsAt(accounts: Account[], moves: { userId: string; payload: Prisma.JsonValue; createdAt: Date }[]) {
  const byLogin = new Map(accounts.map((account) => [account.loginName, account]));
  const movesOf = new Map<string, { from: string; at: number }[]>();
  for (const move of moves) {
    const payload = (move.payload ?? {}) as { kind?: string; subject?: string };
    if (payload.kind !== 'pos' && payload.kind !== 'agent') continue;
    const moved = payload.subject ? byLogin.get(payload.subject) : undefined;
    if (!moved) continue;
    movesOf.set(moved.id, [...(movesOf.get(moved.id) ?? []), { from: move.userId, at: move.createdAt.getTime() }]);
  }
  for (const list of movesOf.values()) list.sort((a, b) => a.at - b.at);
  return (account: Account, at: Date): string | null => movesOf.get(account.id)?.find((move) => move.at > at.getTime())?.from ?? account.parentId;
}

type Tree = { layerOf: (id: string) => string; login: (id: string) => string; pathAt: (userId: string, at: Date | null) => PathNode[] };
type PathNode = { id: string; loginName: string; layer: string; deniedOps: string };
type Built = { ladder: Ladder; today: string[] | null } | string;

/** The accounts, and each one's path up the tree at an instant (null: today). */
async function readTree(tx: Prisma.TransactionClient): Promise<Tree> {
  const accounts: Account[] = await tx.user.findMany({ select: { id: true, loginName: true, layer: true, parentId: true, deniedOps: true } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const parentAt = parentsAt(accounts, await tx.notice.findMany({ where: { kind: 'transfer.out' }, select: { userId: true, payload: true, createdAt: true } }));
  const pathAt = (userId: string, at: Date | null) => {
    const path: Account[] = [];
    let current = byId.get(userId);
    while (current && path.length <= accounts.length && !path.includes(current)) {
      path.push(current);
      const parent: string | null = at ? parentAt(current, at) : current.parentId;
      current = parent ? byId.get(parent) : undefined;
    }
    return path.map((node) => ({ id: node.id, loginName: node.loginName, layer: node.layer, deniedOps: node.deniedOps ?? '' }));
  };
  return { layerOf: (id) => byId.get(id)?.layer ?? '', login: (id) => byId.get(id)?.loginName ?? id, pathAt };
}

/** The sale and refund entries (in `scope`), oldest first, and every sale on the refunds' lines, newest first. */
async function readEntries(tx: Prisma.TransactionClient, scope: BackfillScope | undefined) {
  const users = scope ? { userId: { in: scope.userIds } } : {};
  const entries: Entry[] = await tx.walletEntry.findMany({
    where: { ...users, OR: [{ kind: { in: SALES }, amount: { lt: 0 } }, { kind: { in: REFUNDS }, amount: { gt: 0 } }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: ENTRY_COLUMNS,
  });
  const sales = entries.filter((row) => SALE_KINDS[row.kind] && row.amount < 0);
  const refunds = entries.filter((row) => REFUND_KINDS.has(row.kind) && row.amount > 0);
  // The sales a refund takes its share from: every sale on its line, whoever's wallet it is on (a line moves).
  const refundLines = [...new Set(refunds.filter((row) => row.lineId).map((row) => row.lineId as string))];
  const lineSales: Entry[] = refundLines.length
    ? await tx.walletEntry.findMany({ where: { lineId: { in: refundLines }, kind: { in: SALES }, amount: { lt: 0 } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: ENTRY_COLUMNS })
    : [];
  return { entries, sales, refunds, lineSales };
}

/**
 * Builds an old sale's ladder once, on the path at its time, with today's prices and what the point of sale paid, as
 * the read-time code built it (`ladderOf`): what it is built from is read once for every entry to build.
 */
async function ladderBuilder(tx: Prisma.TransactionClient, rows: Entry[], tree: Tree): Promise<(row: Entry) => Built> {
  const toBuild = rows.filter((row) => !row.ladder && row.lineId);
  const lines = toBuild.length ? await tx.postpaidLine.findMany({ where: { id: { in: [...new Set(toBuild.map((row) => row.lineId as string))] } }, select: { id: true, terms: true } }) : [];
  const codeOf = new Map(lines.map((line) => [line.id, (line.terms as { packageCode?: string } | null)?.packageCode ?? '']));
  const codes = [...new Set([...codeOf.values()].filter(Boolean))];
  const packages = codes.length
    ? await tx.postpaidPackage.findMany({
        where: { code: { in: codes } },
        select: {
          id: true, code: true, branchCost: true, mainPrice: true, agentPrice: true, posPrice: true, subscriberPrice: true,
          renewalBranchCost: true, renewalMainPrice: true, renewalAgentPrice: true, renewalPosPrice: true, renewalSubscriberPrice: true,
        },
      })
    : [];
  const packageIds = packages.map((row) => row.id);
  const [termRows, sellRows] = packageIds.length
    ? await Promise.all([
        tx.postpaidUserPackage.findMany({ where: { packageId: { in: packageIds } }, select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true } }),
        tx.postpaidSellPrice.findMany({ where: { packageId: { in: packageIds } }, select: { packageId: true, ownerId: true, price: true, renewalPrice: true } }),
      ])
    : [[], []];
  const built = new Map<string, Built>();
  const buildOne = (row: Entry): Built => {
    const pkg = packages.find((item) => item.code === codeOf.get(row.lineId ?? ''));
    if (!pkg) return 'its line\'s package cannot be found';
    const path = tree.pathAt(row.userId, row.createdAt);
    if (path.length === 0) return 'its account cannot be found';
    const ids = new Set(path.map((node) => node.id));
    const terms: TermRow[] = termRows.filter((item) => item.packageId === pkg.id && ids.has(item.userId));
    const sells: SellRow[] = sellRows.filter((item) => item.packageId === pkg.id && ids.has(item.ownerId));
    const ladder = ladderOf(path, terms, sells, pkg, SALE_KINDS[row.kind], row.packagePrice);
    const today = tree.pathAt(row.userId, null).map((node) => node.id);
    return { ladder, today: today.join() === ladder.chain.join() ? null : today };
  };
  return (row) => {
    const done = built.get(row.id) ?? buildOne(row);
    built.set(row.id, done);
    return done;
  };
}

/** What to write on each entry, into `run` as it goes: the stored ladders, the ones built, the ones left without. */
function plan(run: BackfillRun, read: Awaited<ReturnType<typeof readEntries>>, build: (row: Entry) => Built, tree: Tree): MarginedEntry[] {
  const writes: MarginedEntry[] = [];
  const consider = (row: Entry, ladder: Ladder, source: Stored['source'], today: string[] | null) => {
    let ids: ChainIds;
    try {
      ids = chainIdsOf(ladder.chain.map((id) => ({ id, layer: tree.layerOf(id) })));
    } catch {
      run.unresolved.push({ id: row.id, kind: row.kind, reason: `its chain holds two accounts of one layer (${ladder.chain.map((id) => `${tree.login(id)}:${tree.layerOf(id) || '?'}`).join(' > ')})` });
      return;
    }
    const columns = marginColumns(ladder, ids);
    if (row.ladder !== null && Object.entries(columns).every(([key, value]) => row[key as keyof typeof columns] === value)) return;
    writes.push({ id: row.id, ladder, columns });
    run.stored.push({
      id: row.id, kind: row.kind, at: row.createdAt.toISOString(), source, chain: ladder.chain.map(tree.login),
      margins: { pos: columns.posMargin, agent: columns.agentMargin, mainAgent: columns.mainAgentMargin, branch: columns.branchMargin },
      ...(today ? { movedFrom: today.map(tree.login) } : {}),
    });
  };
  for (const row of read.sales) {
    const answer: Built = row.ladder ? { ladder: row.ladder as unknown as Ladder, today: null } : row.lineId ? build(row) : 'no line';
    if (typeof answer === 'string') run.without.push({ id: row.id, kind: row.kind, reason: answer });
    else consider(row, answer.ladder, row.ladder ? 'kept' : 'rebuilt', answer.today);
  }
  for (const row of read.refunds) {
    if (row.ladder) {
      consider(row, row.ladder as unknown as Ladder, 'kept', null);
      continue;
    }
    const sale = row.lineId ? read.lineSales.find((item) => item.lineId === row.lineId && item.createdAt <= row.createdAt) : undefined;
    const base: Built = !sale ? 'no sale on its line before it' : sale.ladder ? { ladder: sale.ladder as unknown as Ladder, today: null } : build(sale);
    if (typeof base === 'string') {
      run.without.push({ id: row.id, kind: row.kind, reason: sale ? `its sale ${sale.id}: ${base}` : base });
      continue;
    }
    const ladder = refundLadder(base.ladder, row.amount, row.packagePrice || sale?.packagePrice || 0);
    if (!ladder) run.without.push({ id: row.id, kind: row.kind, reason: 'no price paid to scale its sale by' });
    else consider(row, ladder, 'rebuilt from its sale', base.today);
  }
  return writes;
}

/**
 * Writes, around the provider ledger's CHECK when an old operation row without its provider is among the rows
 * (PostgreSQL checks every CHECK on the row an UPDATE writes); then the invariant, the totals, and the CHECK.
 */
async function writeAndValidate(tx: Prisma.TransactionClient, run: BackfillRun, writes: MarginedEntry[], entries: Entry[], scope: BackfillScope | undefined, tree: Tree) {
  const unpriced = new Set(entries.filter((row) => PROVIDER_KINDS.has(row.kind) && (row.providerId === null || row.providerCost === null)).map((row) => row.id));
  run.liftedProviderCheck = writes.filter((row) => unpriced.has(row.id)).length;
  if (run.liftedProviderCheck > 0) await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" DROP CONSTRAINT "${PROVIDER_CHECK}"`);
  run.written = await rewriteMarginColumns(tx, writes);
  if (run.liftedProviderCheck > 0) {
    const kinds = PROVIDER_OPERATION_KINDS.map((kind) => `'${kind}'`).join(', ');
    await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" ADD CONSTRAINT "${PROVIDER_CHECK}" CHECK ("kind" NOT IN (${kinds}) OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID`);
  }
  run.breaks = marginBreaks(await storedRows(tx, scope), tree.layerOf);
  if (run.breaks.length > 0) throw new Error('the stored margins break the invariant');
  run.totals = await totalsByAccount(tx, scope, tree.login);
  const [left] = await tx.$queryRaw<{ breaking: bigint }[]>`
    SELECT count(*) AS breaking FROM "WalletEntry" WHERE "ladder" IS NOT NULL AND ("chainPosId" IS NULL OR "branchMargin" IS NULL)`;
  run.breaking = Number(left?.breaking ?? 0);
  if (run.breaking === 0) await tx.$executeRawUnsafe(`ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "${CHECK}"`);
  const [state] = await tx.$queryRaw<{ convalidated: boolean }[]>`SELECT convalidated FROM pg_constraint WHERE conname = ${CHECK}`;
  run.validated = Boolean(state?.convalidated);
}

/** Writes the ladder and the margins of every sale and refund entry (in `scope`), checks them, validates the CHECK when it holds, and commits unless asked not to. */
export async function backfillStoredMargins(prisma: PrismaClient, options: BackfillOptions = {}): Promise<BackfillRun> {
  const scope = options.scope;
  const run: BackfillRun = {
    dryRun: Boolean(options.dryRun), sales: 0, refunds: 0, written: 0, stored: [], without: [], unresolved: [], stopped: false,
    liftedProviderCheck: 0, totals: [], breaks: [], breaking: 0, validated: false, committed: false,
  };
  try {
    await transaction(
      prisma,
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "WalletEntry" IN SHARE ROW EXCLUSIVE MODE`;
        const tree = await readTree(tx);
        const read = await readEntries(tx, scope);
        run.sales = read.sales.length;
        run.refunds = read.refunds.length;
        const writes = plan(run, read, await ladderBuilder(tx, [...read.sales, ...read.lineSales], tree), tree);
        if (run.unresolved.length > 0) {
          run.stopped = true;
          throw new RolledBack();
        }
        await writeAndValidate(tx, run, writes, read.entries, scope, tree);
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

/** Every entry (in `scope`) that keeps a ladder or any of the seven columns: what the invariant reads. */
function storedRows(db: Prisma.TransactionClient | PrismaClient, scope: BackfillScope | undefined) {
  const users = scope ? Prisma.sql`AND "userId" IN (${Prisma.join(scope.userIds)})` : Prisma.empty;
  return db.$queryRaw<Parameters<typeof marginBreaks>[0]>`
    SELECT "id", "ladder", "providerLoss", "providerCost", "chainPosId", "chainAgentId", "chainMainAgentId", "posMargin", "agentMargin", "mainAgentMargin", "branchMargin"
    FROM "WalletEntry"
    WHERE ("ladder" IS NOT NULL OR "chainPosId" IS NOT NULL OR "chainAgentId" IS NOT NULL OR "chainMainAgentId" IS NOT NULL
       OR "posMargin" IS NOT NULL OR "agentMargin" IS NOT NULL OR "mainAgentMargin" IS NOT NULL OR "branchMargin" IS NOT NULL) ${users}`;
}

/** What the stored margins add up to for each account, by its layer in the chains: the figures the screens sum. */
async function totalsByAccount(db: Prisma.TransactionClient, scope: BackfillScope | undefined, login: (id: string) => string) {
  const users = scope ? Prisma.sql`AND "userId" IN (${Prisma.join(scope.userIds)})` : Prisma.empty;
  const rows = await db.$queryRaw<{ layer: string; id: string; margin: bigint }[]>`
    SELECT 'pos' AS layer, "chainPosId" AS id, sum("posMargin") AS margin FROM "WalletEntry" WHERE "chainPosId" IS NOT NULL ${users} GROUP BY "chainPosId"
    UNION ALL SELECT 'agent', "chainAgentId", sum("agentMargin") FROM "WalletEntry" WHERE "chainAgentId" IS NOT NULL ${users} GROUP BY "chainAgentId"
    UNION ALL SELECT 'main_agent', "chainMainAgentId", sum("mainAgentMargin") FROM "WalletEntry" WHERE "chainMainAgentId" IS NOT NULL ${users} GROUP BY "chainMainAgentId"
    UNION ALL SELECT 'branch', '', sum("branchMargin") FROM "WalletEntry" WHERE "branchMargin" IS NOT NULL ${users}`;
  const order = ['branch', 'main_agent', 'agent', 'pos'];
  return rows
    .filter((row) => row.margin !== null)
    .map((row) => ({ layer: row.layer, login: row.id ? login(row.id) : 'the branch', margin: Number(row.margin) }))
    .sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer) || a.login.localeCompare(b.login));
}

/** The invariant alone, read-only (`--check`): every entry of the table, on a copy or on the deployment. */
export async function checkStoredMargins(prisma: PrismaClient, scope?: BackfillScope): Promise<{ id: string; reason: string }[]> {
  const layers = new Map((await prisma.user.findMany({ select: { id: true, layer: true } })).map((row) => [row.id, row.layer]));
  return marginBreaks(await storedRows(prisma, scope), (id) => layers.get(id) ?? '');
}

const money = (value: number | null) => (value === null ? '-' : String(value));

/** The run in lines for the log. */
export function backfillLines(run: BackfillRun): string[] {
  const lines: string[] = [];
  for (const row of run.unresolved) lines.push(`unresolved: entry ${row.id} (${row.kind}): ${row.reason}`);
  if (run.stopped) {
    lines.push(`${run.unresolved.length} entr(ies) cannot be stored by layer: report them to the developer (ADR 0026: the share table). Nothing was changed.`);
    return lines;
  }
  const count = (source: Stored['source']) => run.stored.filter((row) => row.source === source).length;
  lines.push(
    `sale entries: ${run.sales}; refund entries: ${run.refunds}; kept ladders given their margins ${count('kept')}; ladders built ${count('rebuilt')} (sales) and ${count('rebuilt from its sale')} (refunds); left without a ladder ${run.without.length}; rows written ${run.written}`,
  );
  for (const row of run.stored) {
    if (row.source === 'kept') continue;
    const margins = `pos ${row.margins.pos}, agent ${money(row.margins.agent)}, main agent ${money(row.margins.mainAgent)}, branch ${row.margins.branch}`;
    lines.push(`built: entry ${row.id} (${row.kind}, ${row.at}) chain ${row.chain.join(' > ')}: ${margins}${row.movedFrom ? `; on the path of its time, today ${row.movedFrom.join(' > ')}` : ''}`);
  }
  for (const row of run.without) lines.push(`no ladder: entry ${row.id} (${row.kind}): ${row.reason}`);
  if (run.liftedProviderCheck > 0) {
    lines.push(`check ${PROVIDER_CHECK}: lifted around ${run.liftedProviderCheck} old operation entr(ies) without a provider and added again NOT VALID: run provider-ledger-backfill next`);
  }
  for (const row of run.totals) lines.push(`stored margins: ${row.layer} ${row.login} ${row.margin}`);
  lines.push(`invariant: ${run.breaks.length} entr(ies) break it`);
  lines.push(run.validated ? `check ${CHECK}: validated` : `check ${CHECK}: left NOT VALID, ${run.breaking} entr(ies) with a ladder and without their margins (new rows are still checked)`);
  lines.push(run.dryRun ? 'dry run: rolled back, nothing was changed' : run.committed ? 'committed' : 'not committed: nothing was changed');
  return lines;
}

const FLAGS = new Set(['--dry-run', '--check']);

/** Runs the backfill (or the check) and answers the exit code. `argv` is the command line after the script's name. */
export async function run(argv: string[] = process.argv.slice(2), client?: PrismaClient): Promise<number> {
  if (argv.some((arg) => !FLAGS.has(arg)) || (argv.includes('--check') && argv.length > 1)) {
    log.error('unknown argument: only --dry-run or --check (alone) are accepted; nothing was read or changed');
    return 2;
  }
  const prisma = client ?? createPrismaClient('tool');
  try {
    if (argv.includes('--check')) {
      const breaks = await checkStoredMargins(prisma);
      for (const row of breaks) log.error(`breaks the invariant: entry ${row.id}: ${row.reason}`);
      log.log(`invariant: ${breaks.length} entr(ies) break it; nothing was changed`);
      return breaks.length ? 1 : 0;
    }
    const done = await backfillStoredMargins(prisma, { dryRun: argv.includes('--dry-run') });
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
