import { PeriodQuery, UnitOfWork, cappedTotal, dayRange, fail, parseInput, cursorPosition, page, FEED_PAGE } from '../../platform';
import { ProvidersRepository } from '../providers.repository';
import { requireAnyGrant, requireGrant } from '../../access';
import { Injectable } from '@nestjs/common';
import { matchOf, matchOverdue } from './match-simulator';
import type { Actor } from '../../access';
import { providerBranchCost } from '../../pricing';
import { csvOf, isOpenLoss, WalletsService, PROVIDER_OPERATION_KINDS } from '../../wallets';
import { ProviderCreditBody, ProviderEntryBody, ProviderMatchingBody, ProviderOperationsQuery, ReconciliationBody, ReconciliationItemBody, StatementFileBody } from '../providers.schemas';
import { linesOf, readSheet, reconcile, suggestMap, type StatementMap } from './statement';

// Our account with each provider (spec 2026-11-08-provider-accounts, roadmap N7): what we bought through our operations,
// what we paid and settled, the credit limit, what open tasks are about to cost, and a ledger with a running balance.
export const LEDGER_LIMIT = 1_000;

// The one open task status: no task is `pending` (migrations 20261109100000 and 20261110100000 rewrote those rows
// to `working`; the `Task_status_known` CHECK refuses the value).
const OPEN_TASKS = ['working'];

type LedgerRow = { id: string; at: Date; kind: string; amount: number; note: string; msisdn: string; packageName: string; actorLoginName: string; loss: string | null };

@Injectable()
export class ProviderAccountsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wallets: WalletsService,
    private readonly repo: ProvidersRepository,
  ) {}

  /**
   * The branch's line operations by provider with their match state (`GET provider-operations`): the provider and
   * the cost each operation stored (ADR 0025), read through `WalletsService.providerOperations` with the provider,
   * the kind, the number and the window in SQL; the match is the provider accounts'.
   */
  async providerOperations(actor: Actor, input: ProviderOperationsQuery = {}) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
    const query = parseInput(ProviderOperationsQuery, input);
    const kind = query.kind && PROVIDER_OPERATION_KINDS.includes(query.kind) ? query.kind : '';
    const needle = (query.q ?? '').replace(/\s/g, '');
    const { from, to } = dayRange(query.from, query.to);
    const now = new Date();
    // Only the rows a figure below reads (database plan DB.4): from the earlier of `from` and the first of this month
    // (server time, as `monthCost` counts it). No upper bound: `monthCost` reads this month whatever `to` is.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = from ? new Date(Math.min(from.getTime(), monthStart.getTime())) : undefined;
    const providers = await this.repo.providersByName();
    const providerByCode = new Map(providers.map((item) => [item.code, item]));
    const providerById = new Map(providers.map((item) => [item.id, item]));
    const named = query.provider ? providerByCode.get(query.provider) : undefined;
    // A provider code that names no provider has no operations.
    const read = query.provider && !named ? [] : await this.wallets.providerOperations({ providerId: named?.id, kind: kind || undefined, msisdn: needle || undefined, from: since, loss: query.loss, named: true });
    const chosen = read.map((row) => ({ ...row, providerCode: providerById.get(row.providerId)?.code ?? '', providerName: providerById.get(row.providerId)?.name ?? '' }));
    // Matching, simulated until real providers are connected (spec E): each row's state against its provider.
    const matchFor = (row: { id: string; at: Date; cost: number; providerCode: string }) => {
      const provider = providerByCode.get(row.providerCode);
      return matchOf(row, { matchSource: provider?.matchSource ?? 'statement', lastMatchedAt: provider?.lastMatchedAt ?? null });
    };
    const dated = chosen.filter((row) => (!from || row.at >= from) && (!to || row.at <= to));
    const matches = new Map(dated.map((row) => [row.id, matchFor(row)]));
    const ranged = query.match === 'matched' || query.match === 'difference' || query.match === 'pending'
      ? dated.filter((row) => matches.get(row.id)?.state === query.match)
      : dated;
    const monthCost = chosen
      .filter((row) => row.at.getFullYear() === now.getFullYear() && row.at.getMonth() === now.getMonth())
      .reduce((sum, row) => sum + row.cost, 0);
    const position = cursorPosition(query.cursor);
    const window = position
      ? ranged.filter((row) => row.at < position.at || (row.at.getTime() === position.at.getTime() && row.id < position.id))
      : ranged;
    const { items, nextCursor } = page(window, FEED_PAGE, (row) => row.at);
    return {
      items: items.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        kind: row.kind,
        /** The point of sale the operation was for (the wallet it is on). */
        loginName: row.loginName,
        msisdn: row.msisdn,
        providerCode: row.providerCode,
        providerName: row.providerName,
        companyName: row.companyName,
        packageName: row.packageName,
        cost: row.cost,
        esimPrice: row.esimPrice,
        /** Why the provider was paid and the point of sale charged nothing (spec DB.5 P.7), or null. */
        loss: row.loss,
        /** What charging a given-back operation takes (spec DB.5 P.9); null on any other row. */
        chargeAmount: row.chargeAmount,
        matchSource: providerByCode.get(row.providerCode)?.matchSource ?? 'statement',
        matchState: matches.get(row.id)?.state ?? 'pending',
        providerAmount: matches.get(row.id)?.providerAmount ?? null,
        difference: matches.get(row.id)?.difference ?? null,
      })),
      nextCursor,
      ...cappedTotal(ranged.length),
      stats: {
        count: ranged.length,
        cost: ranged.reduce((sum, row) => sum + row.cost, 0),
        monthCost,
        matched: dated.filter((row) => matches.get(row.id)?.state === 'matched').length,
        differences: dated.filter((row) => matches.get(row.id)?.state === 'difference').length,
        pending: dated.filter((row) => matches.get(row.id)?.state === 'pending').length,
        differenceAmount: dated.reduce((sum, row) => sum + (matches.get(row.id)?.difference ?? 0), 0),
        /** The window's operations the provider was paid for and the point of sale was not charged for (P.7), still open (P.9). */
        losses: ranged.filter((row) => isOpenLoss(row.loss)).length,
      },
      providers: providers.map((item) => ({ code: item.code, name: item.name, matchSource: item.matchSource })),
    };
  }

  /**
   * Charges the point of sale for a given-back operation (`POST provider-operations/:entryId/charge`, spec DB.5 P.9):
   * the wallets' rule, `WalletsService.chargeGivenBack` (the branch only, as the manual deduction).
   */
  chargeGivenBack(actor: Actor, entryId: string) {
    return this.wallets.chargeGivenBack(actor, entryId);
  }

  /** Reading needs the branch owner or the accounting or reports grant; writing the owner or accounting. */
  private gate(actor: Actor, write: boolean) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
    requireAnyGrant(actor, write ? ['accounting'] : ['accounting', 'reports']);
  }

  /**
   * Purchases, entries and open-task cost of every provider, from one read of each. Purchases, payments and
   * settlements are sums in the database: purchases of the cost each operation stored (ADR 0025 rule 5).
   */
  private async books() {
    const [providers, purchases, losses, sums, tasks, packages] = await Promise.all([
      this.repo.providersByName(),
      this.wallets.providerPurchases(),
      this.wallets.providerLosses(),
      this.repo.entrySums(),
      this.repo.tasksInStatuses(OPEN_TASKS),
      this.repo.packagesWithProvider(),
    ]);
    const packageById = new Map(packages.map((row) => [row.id, row]));
    const held = new Map<string, number>();
    for (const task of tasks) {
      const pkg = packageById.get(task.packageId);
      if (!pkg) continue;
      held.set(pkg.provider.code, (held.get(pkg.provider.code) ?? 0) + providerBranchCost(task.action, null, pkg));
    }
    const paid = new Map(sums.map((row) => [`${row.providerId}:${row.kind}`, row._sum.amount ?? 0]));
    return { providers, purchases, losses, paid, held };
  }

  /**
   * A provider's open differences, simulated (spec E, `matchOf`): its operations a match covers whose «charged»
   * amount differs. Only an operation with a cost can differ (`simulatedCharge` of 0 is 0), and a statement
   * provider's match covers the operations up to `lastMatchedAt` only, so those alone are read. Counted for the
   * list and the detail screens, not for `summaries()` (ADR 0025 rule 5); over an `api` provider it still reads
   * every priced operation of the provider, until a real reconciliation stores its items.
   */
  private async openDifferences(provider: { id: string; matchSource: string; lastMatchedAt: Date | null }): Promise<number> {
    if (provider.matchSource !== 'api' && !provider.lastMatchedAt) return 0;
    const upTo = provider.matchSource === 'api' ? null : provider.lastMatchedAt;
    const rows = await this.wallets.providerOperations({ providerId: provider.id, to: upTo, priced: true });
    return rows.filter((row) => matchOf(row, provider).state === 'difference').length;
  }

  private summaryOf(provider: { id: string; code: string; name: string; creditLimit: number; matchSource?: string; matchEveryDays?: number; lastMatchedAt?: Date | null }, books: Awaited<ReturnType<ProviderAccountsService['books']>>) {
    const matching = {
      matchSource: provider.matchSource ?? 'statement',
      matchEveryDays: provider.matchEveryDays ?? 7,
      lastMatchedAt: provider.lastMatchedAt ?? null,
    };
    const purchases = books.purchases.get(provider.id) ?? 0;
    const payments = books.paid.get(`${provider.id}:payment`) ?? 0;
    const settlements = books.paid.get(`${provider.id}:settlement`) ?? 0;
    const balance = payments + settlements - purchases;
    const held = books.held.get(provider.code) ?? 0;
    return {
      code: provider.code,
      name: provider.name,
      purchases,
      payments,
      settlements,
      balance,
      creditLimit: provider.creditLimit,
      alertFloor: (provider as { alertFloor?: number }).alertFloor ?? 0,
      held,
      available: balance + provider.creditLimit - held,
      matchSource: matching.matchSource,
      matchEveryDays: matching.matchEveryDays,
      lastMatchedAt: matching.lastMatchedAt?.toISOString() ?? null,
      matchOverdue: matchOverdue(matching),
      /** Its operations it was paid for and the point of sale was not charged for, ever (spec DB.5 P.7): the office looks at each. */
      losses: books.losses.get(provider.id) ?? 0,
    };
  }

  /** Every provider's summary with no viewer check: for the API's own health watch (ProviderHealthService). */
  async summaries() {
    const books = await this.books();
    return books.providers.map((provider) => this.summaryOf(provider, books));
  }

  async list(actor: Actor) {
    this.gate(actor, false);
    const books = await this.books();
    const rows = await Promise.all(books.providers.map(async (provider) => ({ ...this.summaryOf(provider, books), openDifferences: await this.openDifferences(provider) })));
    return {
      rows,
      totals: {
        balance: rows.reduce((sum, row) => sum + row.balance, 0),
        held: rows.reduce((sum, row) => sum + row.held, 0),
        owed: rows.reduce((sum, row) => sum + Math.max(0, -row.balance), 0),
      },
    };
  }

  /**
   * One provider: its summary and its ledger page — its operations with a cost and its payments and settlements,
   * newest first, in the dates asked, at most LEDGER_LIMIT rows (`capped` past it). Read by keyset from the newest
   * (ADR 0025 rule 5): each source gives at most LEDGER_LIMIT + 1 rows; the newest row's balance after it is the
   * balance up to `to` (a sum in the database), and each older row's is the one after it less its amount.
   */
  async detail(actor: Actor, code: string, input: PeriodQuery = {}) {
    this.gate(actor, false);
    const query = parseInput(PeriodQuery, input);
    const books = await this.books();
    const provider = books.providers.find((row) => row.code === code);
    if (!provider) fail(404, 'NOT_FOUND');
    const { from, to } = dayRange(query.from, query.to);
    const [operations, entries, cost, paid, openDifferences] = await Promise.all([
      this.wallets.providerOperations({ providerId: provider.id, from, to, priced: true, take: LEDGER_LIMIT + 1 }),
      this.repo.entriesOf(provider.id, from, to, LEDGER_LIMIT + 1),
      this.wallets.providerCostUpTo(provider.id, to),
      this.repo.entryTotalUpTo(provider.id, to),
      this.openDifferences(provider),
    ]);
    const rows: LedgerRow[] = [
      ...operations.map((row) => ({
        id: row.id, at: row.at, kind: row.kind, amount: -row.cost, note: '', msisdn: row.msisdn, packageName: row.packageName, actorLoginName: '', loss: row.loss,
      })),
      ...entries.map((row) => ({
        id: row.id, at: row.createdAt, kind: row.kind, amount: row.amount, note: row.note, msisdn: '', packageName: '', actorLoginName: row.actorLoginName, loss: null,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
    let balance = paid - cost;
    const ledger = rows.slice(0, LEDGER_LIMIT).map((row) => {
      const balanceAfter = balance;
      balance -= row.amount;
      return { ...row, at: row.at.toISOString(), balanceAfter };
    });
    return {
      summary: { ...this.summaryOf(provider, books), openDifferences },
      ledger,
      capped: rows.length > LEDGER_LIMIT,
    };
  }

  async ledgerCsv(actor: Actor, code: string, query: PeriodQuery = {}) {
    const { ledger } = await this.detail(actor, code, query);
    return csvOf(
      ['at', 'kind', 'number', 'package', 'amount', 'balance_after', 'note', 'by'],
      ledger.map((row) => [row.at, row.kind, row.msisdn, row.packageName, { money: row.amount }, { money: row.balanceAfter }, row.note, row.actorLoginName]),
    );
  }

  /** A payment (positive) or a settlement (either sign) with a note, entered by the accountant. */
  async addEntry(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { kind, amount, note: text } = parseInput(ProviderEntryBody, body);
    if (!text) fail(400, 'NOTE_REQUIRED');
    if (amount === 0 || (kind === 'payment' && amount < 0)) fail(400, 'INVALID');
    const provider = await this.repo.providerByCode(code);
    if (!provider) fail(404, 'NOT_FOUND');
    await this.repo.addEntry({ providerId: provider.id, kind, amount, note: text, actorLoginName: actor.loginName });
    return { ok: true };
  }

  async setCredit(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { creditLimit, alertFloor } = parseInput(ProviderCreditBody, body);
    const provider = await this.repo.providerByCode(code);
    if (!provider) fail(404, 'NOT_FOUND');
    await this.repo.setCredit(code, creditLimit, alertFloor);
    return { ok: true };
  }

  /** The matching source and, for a statement provider, how often it must be matched (owner or accounting). */
  async setMatching(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { matchSource, matchEveryDays } = parseInput(ProviderMatchingBody, body);
    await this.providerByCode(code);
    await this.repo.setMatching(code, matchSource, matchEveryDays);
    return { ok: true };
  }

  /**
   * A simulated statement match (spec E): marks every operation up to now as covered by a statement, as the real
   * statement run will once providers send theirs. The uploaded-statement reconciliation stays as it is.
   */
  async simulateStatement(actor: Actor, code: string) {
    this.gate(actor, true);
    const provider = await this.providerByCode(code);
    if (provider.matchSource !== 'statement') fail(400, 'INVALID');
    const lastMatchedAt = new Date();
    await this.repo.markMatched(code, lastMatchedAt);
    return { ok: true, lastMatchedAt: lastMatchedAt.toISOString() };
  }

  private async providerByCode(code: string) {
    const provider = await this.repo.providerByCode(code);
    if (!provider) fail(404, 'NOT_FOUND');
    return provider;
  }

  private async sheetOf(body: { fileName: string; content: string }) {
    try {
      return await readSheet(body.fileName, Buffer.from(body.content, 'base64'));
    } catch {
      fail(400, 'INVALID');
    }
  }

  /** The statement's columns, a few rows, and the columns to use: the provider's saved choice, else a guess. */
  async previewStatement(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const file = parseInput(StatementFileBody, body);
    const provider = await this.providerByCode(code);
    const sheet = await this.sheetOf(file);
    const saved = provider.statementMap as StatementMap | null;
    const fits = saved && [saved.msisdn, saved.date, saved.amount].every((index) => index < sheet.columns.length);
    return { columns: sheet.columns, sample: sheet.rows.slice(0, 5), rows: sheet.rows.length, map: fits ? saved : suggestMap(sheet.columns) };
  }

  /**
   * Compares the statement with our operations at this provider over its dates (± one day), saves the run and its
   * non-matching rows, and keeps the column choice for next time (spec 2026-11-08-provider-reconciliation).
   */
  async runReconciliation(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { fileName, content, map } = parseInput(ReconciliationBody, body);
    const provider = await this.providerByCode(code);
    const sheet = await this.sheetOf({ fileName, content });
    const { lines, skipped } = linesOf(sheet, map);
    if (lines.length === 0) fail(400, 'INVALID');
    const times = lines.map((line) => line.at.getTime());
    const from = new Date(Math.min(...times) - 86_400_000);
    const to = new Date(Math.max(...times) + 86_400_000);
    // This provider's operations with a cost over the statement's dates (± one day), read in the database.
    const ours = (await this.wallets.providerOperations({ providerId: provider.id, from, to, priced: true }))
      .map((op) => ({ id: op.id, msisdn: op.msisdn, at: op.at, amount: op.cost }));
    const result = reconcile(lines, ours);
    // The unit of work's transaction (slice R.7; before it, the root client's own): the same two writes, in order.
    const run = await this.uow.runTx(async (tx) => {
      await this.repo.saveStatementMap(tx, provider.id, map);
      return this.repo.saveReconciliation(tx, {
        providerId: provider.id,
        fileName,
        periodFrom: new Date(Math.min(...times)),
        periodTo: new Date(Math.max(...times)),
        statementTotal: result.statementTotal,
        ourTotal: result.ourTotal,
        counts: { ...result.counts, skipped },
        actorLoginName: actor.loginName,
        items: { create: result.rows.map((row) => ({ ...row, status: 'open' })) },
      });
    });
    return this.reconciliation(actor, run.id);
  }

  async reconciliations(actor: Actor, code: string) {
    this.gate(actor, false);
    const provider = await this.providerByCode(code);
    const runs = await this.repo.reconciliationsOfProvider(provider.id);
    return {
      runs: runs.map((run) => ({
        id: run.id,
        at: run.createdAt.toISOString(),
        fileName: run.fileName,
        periodFrom: run.periodFrom?.toISOString() ?? null,
        periodTo: run.periodTo?.toISOString() ?? null,
        statementTotal: run.statementTotal,
        ourTotal: run.ourTotal,
        counts: run.counts,
        open: run.items.filter((item) => item.status === 'open').length,
        actorLoginName: run.actorLoginName,
      })),
    };
  }

  async reconciliation(actor: Actor, id: string) {
    this.gate(actor, false);
    const run = await this.repo.reconciliationById(id);
    if (!run) fail(404, 'NOT_FOUND');
    const order = ['different', 'missing_ours', 'missing_theirs', 'duplicate'];
    return {
      id: run.id,
      providerCode: run.provider.code,
      providerName: run.provider.name,
      at: run.createdAt.toISOString(),
      fileName: run.fileName,
      periodFrom: run.periodFrom?.toISOString() ?? null,
      periodTo: run.periodTo?.toISOString() ?? null,
      statementTotal: run.statementTotal,
      ourTotal: run.ourTotal,
      counts: run.counts,
      actorLoginName: run.actorLoginName,
      items: run.items
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
        .map((item) => ({ ...item, at: item.at?.toISOString() ?? null, resolvedAt: item.resolvedAt?.toISOString() ?? null })),
    };
  }

  /** Marks a difference handled (with a note) or opens it again. */
  async updateItem(actor: Actor, id: string, body: unknown) {
    this.gate(actor, true);
    const { status, note: text } = parseInput(ReconciliationItemBody, body);
    if (status === 'resolved' && !text) fail(400, 'NOTE_REQUIRED');
    const item = await this.repo.reconItemById(id);
    if (!item) fail(404, 'NOT_FOUND');
    await this.repo.updateReconItem(
      id,
      status === 'resolved'
        ? { status, note: text, resolvedBy: actor.loginName, resolvedAt: new Date() }
        : { status, resolvedBy: null, resolvedAt: null, ...(text ? { note: text } : {}) },
    );
    return { ok: true };
  }
}
