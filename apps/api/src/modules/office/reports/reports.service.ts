import { CursorQuery } from '../wallets/wallets.schemas';
import { parseInput } from '../../shared/input';
import { ReportsRepository } from './reports.repository';
import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { after, capList, cursorPosition, page } from '../../shared/paging';
import { FEED_PAGE } from '../rules/office-paging';
import { PROVIDER_OPERATION_KINDS } from '../wallets/provider-cost';

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
      total: rows.length,
    };
  }

  /** One page of the wallet entries of provider operations, newest first. */
  async operations(actor: Actor, input: CursorQuery = {}) {
    this.gate(actor);
    return this.entryReport(parseInput(CursorQuery, input).cursor, PROVIDER_OPERATION_KINDS);
  }

  private gate(actor: Actor) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
  }

  private async entryReport(cursor: string | undefined, kinds?: string[]) {
    const where = kinds ? { kind: { in: kinds } } : {};
    const [read, total] = await Promise.all([
      this.repo.entriesPage({ ...where, AND: after(cursorPosition(cursor)) }, FEED_PAGE + 1),
      this.repo.entryCount(where),
    ]);
    const { items: rows, nextCursor } = page(read, FEED_PAGE);
    return {
      total,
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
