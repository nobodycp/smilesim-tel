import { ProvidersRepository } from '../providers.repository';
import { UnitOfWork, logger, reason, env, isTest, PROVIDER_FAILED_NOTE, SYSTEM_SENDER_NAME } from '../../platform';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Actor } from '../../access';
import { FAILURE_WINDOW_MINUTES, HEALTH_CHECK_SECONDS, healthOf, type Health } from './provider-health';
import { ProviderAccountsService } from '../account/provider-accounts.service';
import { matchOverdue } from '../account/match-simulator';
import type { NoticeDraft } from '../../notifications';

const log = logger('ProviderHealth');

/** The sender of the system's own notices: no account, so every recipient hears it. */
const SYSTEM: Actor = { id: 'system', loginName: 'system', nickname: SYSTEM_SENDER_NAME, layer: 'branch', isBranchOwner: false, grants: [], operatorId: 'system', impersonating: false };

export type ProviderHealthRow = Health & { code: string; name: string; failures: number; available: number; alertFloor: number };

/** What the health rule reads of a provider's summary (`ProviderAccountsService.summaries`). */
export type HealthSummary = { code: string; name: string; available: number };

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
  /**
   * The summaries the watch last worked out in this process, and when (database plan DB.4). `summaries()` reads
   * every operation entry ever, so the health view is worked out at most once a HEALTH_CHECK_SECONDS: the watch's
   * own `check` works it out afresh, and `current()` without summaries of its own (the system monitor's providers
   * part) reuses it within that window. A screen that shows a provider's balance never reads it: the overview
   * hands its own exact summaries to `current` (spec decision 12).
   */
  private watched: { at: number; summaries: Promise<HealthSummary[]> } | null = null;

  constructor(private readonly uow: UnitOfWork, private readonly accounts: ProviderAccountsService, private readonly repo: ProvidersRepository) {}

  onModuleInit() {
    if (isTest() || !env('DATABASE_URL')) return;
    this.timer = setInterval(() => void this.check().then(() => this.checkMatching()).catch((error) => log.warn(`check failed: ${reason(error)}`)), HEALTH_CHECK_SECONDS * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * The watch's summaries: worked out afresh when `fresh` (the timer's `check`), else the ones worked out within the
   * last HEALTH_CHECK_SECONDS when there are some. Readers at the same time share one read; a failed read is not kept.
   */
  private watchedSummaries(fresh: boolean): Promise<HealthSummary[]> {
    const clock = Date.now();
    if (!fresh && this.watched && clock - this.watched.at < HEALTH_CHECK_SECONDS * 1000) return this.watched.summaries;
    const entry = { at: clock, summaries: this.accounts.summaries() };
    this.watched = entry;
    entry.summaries.catch(() => {
      if (this.watched === entry) this.watched = null;
    });
    return entry.summaries;
  }

  /**
   * Each provider's health now: `check` compares it with the stored one, the system monitor shows it, and the
   * overview reads it with the summaries it has just worked out (`summaries`), so its health and its balances come
   * from one exact read. Without them the watch's summaries are used (`watchedSummaries`). Failures are counted at
   * each call.
   */
  async current(now: Date = new Date(), summaries?: HealthSummary[], fresh = false): Promise<ProviderHealthRow[]> {
    const [rows, providers, failed] = await Promise.all([
      summaries ?? this.watchedSummaries(fresh),
      this.repo.providerFloorsAndPackages(),
      this.repo.tasksNotedSince(PROVIDER_FAILED_NOTE, new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60_000)),
    ]);
    const byCode = new Map(providers.map((row) => [row.code, row]));
    return rows.map((summary) => {
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
    const providers = await this.repo.providersMatchingState();
    const sent: string[] = [];
    for (const provider of providers) {
      const overdue = matchOverdue(provider, now);
      if (!overdue) {
        if (provider.matchOverdueNoticeAt) await this.repo.clearMatchOverdueNotice(provider.code);
        continue;
      }
      if (provider.matchOverdueNoticeAt) continue;
      const won = await this.repo.claimMatchOverdueNotice(provider.code, now);
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
    const rows = await this.current(now, undefined, true);
    const changed: ProviderHealthRow[] = [];
    for (const row of rows) {
      const stored = row.status === 'problem' ? 'working' : 'problem';
      const won = await this.repo.claimHealthChange(row.code, stored, { health: row.status, healthReason: row.reason, healthAt: now });
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
    const accounts = await this.repo.branchAccounts();
    const recipients = accounts.filter((account) => account.isBranchOwner || account.liveGrants.split(',').includes('edit')).map((account) => account.id);
    await this.uow.runTx(async (tx) => {
      this.uow.queueNotices(tx, await this.uow.notice.write(tx, recipients, SYSTEM, draft));
    });
  }
}
