import { CursorQuery } from '../../wallets';
import { parseInput, fail, after, capList, cappedTotal, countUpTo, cursorPosition, page, FEED_PAGE } from '../../platform';
import { ReportsRepository } from './reports.repository';
import { requireGrant } from '../../access';
import { Injectable } from '@nestjs/common';
import type { Actor } from '../../access';
import type { Prisma } from '../../../generated/prisma/client';

/** Branch reports: providers and packages, and the provider-operations ledger. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
  ) {}

  /** Every package by provider, with what it costs the branch and how many numbers are on it. */
  async providers(actor: Actor) {
    this.gate(actor);
    const { rows } = capList(await this.repo.packagesByProvider());
    return {
      items: rows.map((row) => ({
        providerName: row.provider.name,
        companyName: row.company?.name ?? '',
        packageName: row.name,
        price: row.branchCost,
        lines: row._count.lines,
      })),
      nextCursor: null,
      ...cappedTotal(rows.length),
    };
  }

  /** One page of the wallet entries of provider operations — the entries that stored a provider (spec F.5) — newest first. */
  async operations(actor: Actor, input: CursorQuery = {}) {
    this.gate(actor);
    return this.entryReport(parseInput(CursorQuery, input).cursor, { providerId: { not: null } });
  }

  private gate(actor: Actor) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
  }

  private async entryReport(cursor: string | undefined, where: Prisma.WalletEntryWhereInput = {}) {
    const [read, counted] = await Promise.all([
      this.repo.entriesPage({ ...where, AND: after(cursorPosition(cursor)) }, FEED_PAGE + 1),
      countUpTo((take) => this.repo.entryCount(where, take)),
    ]);
    const { items: rows, nextCursor } = page(read, FEED_PAGE);
    return {
      ...counted,
      items: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        actorLoginName: row.actor.loginName,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        kind: row.kind,
        note: row.note,
      })),
      nextCursor,
    };
  }
}
