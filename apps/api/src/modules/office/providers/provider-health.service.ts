import { logger, reason } from '../../shared/log';
import { env, isTest } from '../../../config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { PROVIDER_FAILED_NOTE, SYSTEM_SENDER_NAME } from '../stored-text';
import { FAILURE_WINDOW_MINUTES, HEALTH_CHECK_SECONDS, healthOf, type Health } from './provider-health';
import { ProviderAccountsService } from './provider-accounts.service';
import { matchOverdue } from './match-simulator';
import type { NoticeDraft } from '../notice-kinds';

const log = logger('ProviderHealth');

/** The sender of the system's own notices: no account, so every recipient hears it. */
const SYSTEM: Actor = { id: 'system', loginName: 'system', nickname: SYSTEM_SENDER_NAME, layer: 'branch', isBranchOwner: false, grants: [], operatorId: 'system', impersonating: false };

export type ProviderHealthRow = Health & { code: string; name: string; failures: number; available: number; alertFloor: number };

/**
 * Watches the providers (spec 2026-11-08-overview-and-reports-nav, G): every HEALTH_CHECK_SECONDS it reads each
 * provider's health, and when one changes from working to problem (or back) it stores the new status and tells
 * the branch owner and the staff with the edit grant. The status is changed with a compare-and-set on the stored
 * value, so with several API processes only the one that changed it writes the notice. Off under tests and
 * without a database, like the catalog seed.
 */
@Injectable()
export class ProviderHealthService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly kernel: OfficeKernel, private readonly accounts: ProviderAccountsService) {}

  onModuleInit() {
    if (isTest() || !env('DATABASE_URL')) return;
    this.timer = setInterval(() => void this.check().then(() => this.checkMatching()).catch((error) => log.warn(`check failed: ${reason(error)}`)), HEALTH_CHECK_SECONDS * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Each provider's health now: the overview reads it, and `check` compares it with the stored one. */
  async current(now: Date = new Date()): Promise<ProviderHealthRow[]> {
    const prisma = this.kernel.prisma;
    const [summaries, providers, failed] = await Promise.all([
      this.accounts.summaries(),
      prisma.provider.findMany({ select: { code: true, alertFloor: true, packages: { select: { id: true } } } }),
      prisma.officeTask.findMany({
        where: { note: PROVIDER_FAILED_NOTE, createdAt: { gte: new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60_000) } },
        select: { packageId: true },
      }),
    ]);
    const byCode = new Map(providers.map((row) => [row.code, row]));
    return summaries.map((summary) => {
      const provider = byCode.get(summary.code);
      const packageIds = new Set(provider?.packages.map((row) => row.id) ?? []);
      const failures = failed.filter((task) => packageIds.has(task.packageId)).length;
      const alertFloor = provider?.alertFloor ?? 0;
      return { code: summary.code, name: summary.name, failures, available: summary.available, alertFloor, ...healthOf({ available: summary.available, alertFloor, recentFailures: failures }) };
    });
  }

  /**
   * A statement provider not matched within its period gets «مطابقة متأخرة» once per lapse (spec E): the notice time
   * is set by compare-and-set, and cleared when the provider is matched again or stops being overdue.
   */
  async checkMatching(now: Date = new Date()): Promise<string[]> {
    const providers = await this.kernel.prisma.provider.findMany({
      select: { code: true, name: true, matchSource: true, matchEveryDays: true, lastMatchedAt: true, matchOverdueNoticeAt: true },
    });
    const sent: string[] = [];
    for (const provider of providers) {
      const overdue = matchOverdue(provider, now);
      if (!overdue) {
        if (provider.matchOverdueNoticeAt) await this.kernel.prisma.provider.updateMany({ where: { code: provider.code }, data: { matchOverdueNoticeAt: null } });
        continue;
      }
      if (provider.matchOverdueNoticeAt) continue;
      const won = await this.kernel.prisma.provider.updateMany({ where: { code: provider.code, matchOverdueNoticeAt: null }, data: { matchOverdueNoticeAt: now } });
      if (won.count === 0) continue;
      sent.push(provider.code);
      await this.send({
        kind: 'provider.match_overdue',
        payload: { code: provider.code, name: provider.name, matchEveryDays: provider.matchEveryDays, lastMatchedAt: provider.lastMatchedAt?.toISOString() ?? null },
      });
    }
    return sent;
  }

  /** Stores every change and writes its notice once. Answers the providers that changed. */
  async check(now: Date = new Date()): Promise<ProviderHealthRow[]> {
    const rows = await this.current(now);
    const changed: ProviderHealthRow[] = [];
    for (const row of rows) {
      const stored = row.status === 'problem' ? 'working' : 'problem';
      const won = await this.kernel.prisma.provider.updateMany({
        where: { code: row.code, health: stored },
        data: { health: row.status, healthReason: row.reason, healthAt: now },
      });
      if (won.count === 0) continue;
      changed.push(row);
      await this.notify(row);
    }
    return changed;
  }

  private async notify(row: ProviderHealthRow) {
    await this.send({
      kind: row.status === 'problem' ? 'provider.problem' : 'provider.recovered',
      payload: { code: row.code, name: row.name, reason: row.reason, failures: row.failures, available: row.available, alertFloor: row.alertFloor },
    });
  }

  /** The branch owner and the staff with the edit grant hear the provider notices. */
  private async send(draft: NoticeDraft) {
    const accounts = await this.kernel.prisma.user.findMany({
      where: { layer: 'branch', disabledAt: null },
      select: { id: true, isBranchOwner: true, liveGrants: true },
    });
    const recipients = accounts.filter((account) => account.isBranchOwner || account.liveGrants.split(',').includes('edit')).map((account) => account.id);
    await this.kernel.runTx(async (tx) => {
      this.kernel.queueNotices(tx, await this.kernel.notice.write(tx, recipients, SYSTEM, draft));
    });
  }
}
