import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../../shared/office-failure';
import { parseInput } from '../../shared/input';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { providerBranchCost } from '../office-rules';
import { csvOf } from '../reports/report-csv';
import { MAX_AGOROT, ceilingValue } from '../wallet.schemas';
import { WalletsService } from '../wallets/wallets.service';

// Our account with each provider (spec 2026-11-08-provider-accounts, roadmap N7): what we bought through our operations,
// what we paid and settled, the credit limit, what open tasks are about to cost, and a ledger with a running balance.
export const LEDGER_LIMIT = 1_000;

const note = z.unknown().transform((value) => (typeof value === 'string' ? value.trim() : ''));
const EntryBody = z.object({
  kind: z.enum(['payment', 'settlement']),
  amount: z.number().int().min(-MAX_AGOROT).max(MAX_AGOROT),
  note,
});
const CreditBody = z.object({ creditLimit: ceilingValue });
const OPEN_TASKS = ['pending', 'working'];

type LedgerRow = { id: string; at: Date; kind: string; amount: number; note: string; msisdn: string; packageName: string; actorLogin: string };

@Injectable()
export class ProviderAccountsService {
  constructor(
    private readonly kernel: OfficeKernel,
    private readonly wallets: WalletsService,
  ) {}

  /** Reading needs the branch owner or the accounting or reports grant; writing the owner or accounting. */
  private gate(actor: Actor, write: boolean) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
    if (actor.isBranchOwner) return;
    const allowed = write ? actor.grants.includes('accounting') : actor.grants.includes('accounting') || actor.grants.includes('reports');
    if (!allowed) fail(403, 'FORBIDDEN');
  }

  /** Purchases, entries and open-task cost of every provider, from one read of each. */
  private async books() {
    const [providers, operations, entries, tasks, packages] = await Promise.all([
      this.kernel.prisma.provider.findMany({ orderBy: { name: 'asc' } }),
      this.wallets.pricedOperations(),
      this.kernel.prisma.providerEntry.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.kernel.prisma.officeTask.findMany({ where: { status: { in: OPEN_TASKS } }, select: { action: true, packageId: true } }),
      this.kernel.prisma.package.findMany({ include: { provider: true } }),
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

  private summaryOf(provider: { id: string; code: string; name: string; creditLimit: number }, books: Awaited<ReturnType<ProviderAccountsService['books']>>) {
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
      held,
      available: balance + provider.creditLimit - held,
    };
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
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
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
    const { kind, amount, note: text } = parseInput(EntryBody, body);
    if (!text) fail(400, 'NOTE_REQUIRED');
    if (amount === 0 || (kind === 'payment' && amount < 0)) fail(400, 'INVALID');
    const provider = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!provider) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.providerEntry.create({ data: { providerId: provider.id, kind, amount, note: text, actorLogin: actor.loginName } });
    return { ok: true };
  }

  async setCredit(actor: Actor, code: string, body: unknown) {
    this.gate(actor, true);
    const { creditLimit } = parseInput(CreditBody, body);
    const provider = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!provider) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.provider.update({ where: { code }, data: { creditLimit } });
    return { ok: true };
  }
}
