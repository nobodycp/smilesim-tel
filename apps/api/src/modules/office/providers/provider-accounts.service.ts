import { ProvidersRepository } from './providers.repository';
import { UnitOfWork } from '../kernel/unit-of-work';
import { dayRange } from '../../shared/dates';
import { requireAnyGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { parseInput } from '../../shared/input';
import { matchOf, matchOverdue } from './match-simulator';
import type { Actor } from '../kernel/types';
import { providerBranchCost } from '../rules/office-rules';
import { csvOf } from '../reports/report-csv';
import { WalletsService } from '../wallets/wallets.service';
import { ProviderCreditBody, ProviderEntryBody, ProviderMatchingBody, ReconciliationBody, ReconciliationItemBody, StatementFileBody } from './providers.schemas';
import { linesOf, readSheet, reconcile, suggestMap, type StatementMap } from './statement';

// Our account with each provider (spec 2026-11-08-provider-accounts, roadmap N7): what we bought through our operations,
// what we paid and settled, the credit limit, what open tasks are about to cost, and a ledger with a running balance.
export const LEDGER_LIMIT = 1_000;

const OPEN_TASKS = ['pending', 'working'];

type LedgerRow = { id: string; at: Date; kind: string; amount: number; note: string; msisdn: string; packageName: string; actorLogin: string };

@Injectable()
export class ProviderAccountsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wallets: WalletsService,
    readonly repo: ProvidersRepository,
  ) {}

  /** Reading needs the branch owner or the accounting or reports grant; writing the owner or accounting. */
  private gate(actor: Actor, write: boolean) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
    requireAnyGrant(actor, write ? ['accounting'] : ['accounting', 'reports']);
  }

  /** Purchases, entries and open-task cost of every provider, from one read of each. */
  private async books() {
    const [providers, operations, entries, tasks, packages] = await Promise.all([
      this.uow.prisma.provider.findMany({ orderBy: { name: 'asc' } }),
      this.wallets.pricedOperations(),
      this.uow.prisma.providerEntry.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.uow.prisma.officeTask.findMany({ where: { status: { in: OPEN_TASKS } }, select: { action: true, packageId: true } }),
      this.uow.prisma.package.findMany({ include: { provider: true } }),
    ]);
    const packageById = new Map(packages.map((row) => [row.id, row]));
    const held = new Map<string, number>();
    for (const task of tasks) {
      const pkg = packageById.get(task.packageId);
      if (!pkg) continue;
      held.set(pkg.provider.code, (held.get(pkg.provider.code) ?? 0) + providerBranchCost(task.action, null, pkg));
    }
    return { providers, operations, entries, held };
  }

  private summaryOf(provider: { id: string; code: string; name: string; creditLimit: number; matchSource?: string; matchEveryDays?: number; lastMatchedAt?: Date | null }, books: Awaited<ReturnType<ProviderAccountsService['books']>>) {
    const matching = {
      matchSource: provider.matchSource ?? 'statement',
      matchEveryDays: provider.matchEveryDays ?? 7,
      lastMatchedAt: provider.lastMatchedAt ?? null,
    };
    // Open differences (simulated matching, spec E): this provider's operations whose «charged» amount differs.
    const openDifferences = books.operations.filter((row) => row.providerCode === provider.code && matchOf(row, matching).state === 'difference').length;
    const purchases = books.operations.filter((row) => row.providerCode === provider.code).reduce((sum, row) => sum + row.cost, 0);
    const own = books.entries.filter((row) => row.providerId === provider.id);
    const payments = own.filter((row) => row.kind === 'payment').reduce((sum, row) => sum + row.amount, 0);
    const settlements = own.filter((row) => row.kind === 'settlement').reduce((sum, row) => sum + row.amount, 0);
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
      openDifferences,
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
    const rows = books.providers.map((provider) => this.summaryOf(provider, books));
    return {
      rows,
      totals: {
        balance: rows.reduce((sum, row) => sum + row.balance, 0),
        held: rows.reduce((sum, row) => sum + row.held, 0),
        owed: rows.reduce((sum, row) => sum + Math.max(0, -row.balance), 0),
      },
    };
  }

  /** One provider: its summary and its ledger (purchases and entries, newest first, each with the balance after it). */
  async detail(actor: Actor, code: string, query: { from?: string; to?: string } = {}) {
    this.gate(actor, false);
    const books = await this.books();
    const provider = books.providers.find((row) => row.code === code);
    if (!provider) fail(404, 'NOT_FOUND');
    const rows: LedgerRow[] = [
      ...books.operations.filter((row) => row.providerCode === code && row.cost !== 0).map((row) => ({
        id: row.id, at: row.at, kind: row.kind, amount: -row.cost, note: '', msisdn: row.msisdn, packageName: row.packageName, actorLogin: '',
      })),
      ...books.entries.filter((row) => row.providerId === provider.id).map((row) => ({
        id: row.id, at: row.createdAt, kind: row.kind, amount: row.amount, note: row.note, msisdn: '', packageName: '', actorLogin: row.actorLogin,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    let running = 0;
    const withBalance = rows.map((row) => {
      running += row.amount;
      return { ...row, balanceAfter: running };
    });
    const { from, to } = dayRange(query.from, query.to);
    const ranged = withBalance
      .filter((row) => (!from || Number.isNaN(from.getTime()) || row.at >= from) && (!to || Number.isNaN(to.getTime()) || row.at <= to))
      .reverse();
    return {
      summary: this.summaryOf(provider, books),
      ledger: ranged.slice(0, LEDGER_LIMIT).map((row) => ({ ...row, at: row.at.toISOString() })),
      capped: ranged.length > LEDGER_LIMIT,
    };
  }

  async ledgerCsv(actor: Actor, code: string, query: { from?: string; to?: string } = {}) {
    const { ledger } = await this.detail(actor, code, query);
    return csvOf(
      ['at', 'kind', 'number', 'package', 'amount', 'balance_after', 'note', 'by'],
      ledger.map((row) => [row.at, row.kind, row.msisdn, row.packageName, { money: row.amount }, { money: row.balanceAfter }, row.note, row.actorLogin]),
    );
  }

  /** A payment (positive) or a settlement (either sign) with a note, entered by the accountant. */
  async addEntry(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { kind, amount, note: text } = parseInput(ProviderEntryBody, body);
    if (!text) fail(400, 'NOTE_REQUIRED');
    if (amount === 0 || (kind === 'payment' && amount < 0)) fail(400, 'INVALID');
    const provider = await this.uow.prisma.provider.findUnique({ where: { code } });
    if (!provider) fail(404, 'NOT_FOUND');
    await this.uow.prisma.providerEntry.create({ data: { providerId: provider.id, kind, amount, note: text, actorLogin: actor.loginName } });
    return { ok: true };
  }

  async setCredit(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { creditLimit, alertFloor } = parseInput(ProviderCreditBody, body);
    const provider = await this.uow.prisma.provider.findUnique({ where: { code } });
    if (!provider) fail(404, 'NOT_FOUND');
    await this.uow.prisma.provider.update({ where: { code }, data: { creditLimit, ...(alertFloor !== undefined ? { alertFloor } : {}) } });
    return { ok: true };
  }

  /** The matching source and, for a statement provider, how often it must be matched (owner or accounting). */
  async setMatching(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { matchSource, matchEveryDays } = parseInput(ProviderMatchingBody, body);
    await this.providerByCode(code);
    await this.uow.prisma.provider.update({ where: { code }, data: { matchSource, matchEveryDays } });
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
    await this.uow.prisma.provider.update({ where: { code }, data: { lastMatchedAt, matchOverdueNoticeAt: null } });
    return { ok: true, lastMatchedAt: lastMatchedAt.toISOString() };
  }

  private async providerByCode(code: string) {
    const provider = await this.uow.prisma.provider.findUnique({ where: { code } });
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
    const ours = (await this.wallets.pricedOperations())
      .filter((op) => op.providerCode === code && op.cost !== 0 && op.at >= from && op.at <= to)
      .map((op) => ({ id: op.id, msisdn: op.msisdn, at: op.at, amount: op.cost }));
    const result = reconcile(lines, ours);
    const run = await this.uow.prisma.$transaction(async (tx) => {
      await tx.provider.update({ where: { id: provider.id }, data: { statementMap: map } });
      return tx.providerReconciliation.create({
        data: {
          providerId: provider.id,
          fileName,
          periodFrom: new Date(Math.min(...times)),
          periodTo: new Date(Math.max(...times)),
          statementTotal: result.statementTotal,
          ourTotal: result.ourTotal,
          counts: { ...result.counts, skipped },
          actorLogin: actor.loginName,
          items: { create: result.rows.map((row) => ({ ...row, status: 'open' })) },
        },
      });
    });
    return this.reconciliation(actor, run.id);
  }

  async reconciliations(actor: Actor, code: string) {
    this.gate(actor, false);
    const provider = await this.providerByCode(code);
    const runs = await this.uow.prisma.providerReconciliation.findMany({
      where: { providerId: provider.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: { select: { status: true } } },
    });
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
        actorLogin: run.actorLogin,
      })),
    };
  }

  async reconciliation(actor: Actor, id: string) {
    this.gate(actor, false);
    const run = await this.uow.prisma.providerReconciliation.findUnique({ where: { id }, include: { items: true, provider: true } });
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
      actorLogin: run.actorLogin,
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
    const item = await this.uow.prisma.providerReconItem.findUnique({ where: { id } });
    if (!item) fail(404, 'NOT_FOUND');
    await this.uow.prisma.providerReconItem.update({
      where: { id },
      data: status === 'resolved'
        ? { status, note: text, resolvedBy: actor.loginName, resolvedAt: new Date() }
        : { status, resolvedBy: null, resolvedAt: null, ...(text ? { note: text } : {}) },
    });
    return { ok: true };
  }
}
