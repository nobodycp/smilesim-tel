'use client';

import { ArrowDownRight, ArrowUpRight, Zap } from 'lucide-react';
import Link from 'next/link';
import { AccountName } from '../../components/account-name';
import { Money, actionName, latinWhen } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { buttonClass } from '../../components/ui/button';
import { LoadFailed } from '../../components/load-failed';
import { Spinner, TableSkeleton } from '../../components/loading';
import { TrendLine } from '../../components/trend-line';
import type { FinanceSummary, HomePayload, OverviewPayload, PulseTotals, TaskRow } from '../../lib/api';
import { noticeAge } from '../../lib/notice-text';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';

type Period = OverviewPayload['period'];

/** The relative change against the same span before: up or down, in percent; nothing over all time. */
function Change({ now, before, period }: { now: number; before: number | null | undefined; period: Period }) {
  const { t } = usePrefs();
  if (period === 'all' || before === null || before === undefined) return null;
  const versus = period === 'day' ? t.vsYesterday : t.vsLastMonth;
  if (before === 0 && now === 0) return <span className="change flat" title={versus}>0%</span>;
  if (before === 0) return <span className="change up" title={versus}><ArrowUpRight size={13} aria-hidden="true" />{t.changeNew}</span>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const up = pct >= 0;
  return (
    <span className={`change ${pct === 0 ? 'flat' : up ? 'up' : 'down'}`} title={versus} aria-label={`${up ? '+' : ''}${pct}% ${versus}`}>
      {pct === 0 ? null : up ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
      <bdi dir="ltr">{Math.abs(pct)}%</bdi>
    </span>
  );
}

// A step is an hour (YYYY-MM-DDTHH), a day (YYYY-MM-DD) or a month (YYYY-MM).
const stepLabel = (period: Period, at: string) => (at.length === 13 ? (period === 'day' ? `${at.slice(11)}:00` : `${at.slice(5, 10)} ${at.slice(11)}:00`) : at.length === 10 ? at.slice(5) : at);

/**
 * The top of the home page (approved Graphite design, owner 2026-11-09): the available balance with its ceiling as
 * twenty ticks, then three cards that follow the period switch — sales (every sale operation and its volume), new
 * subscriptions (activations) and profit — each with its change against the same span of yesterday or last month in
 * the corner and its trend inside, and the active numbers with those ending within three days.
 */
export function AccountBand({ summary, home, overview, period, branch = false }: { summary: FinanceSummary | null | undefined; home: HomePayload | null | undefined; overview: OverviewPayload | null | undefined; period: Period; branch?: boolean }) {
  const { t } = usePrefs();
  const held = summary?.held ?? 0;
  const available = summary ? (summary.unlimited ? summary.balance : summary.balance + summary.ceiling - held) : 0;
  const used = summary && !summary.unlimited && summary.ceiling > 0 ? Math.max(0, -summary.balance) + held : 0;
  const share = summary && !summary.unlimited && summary.ceiling > 0 ? Math.min(1, used / summary.ceiling) : 0;
  const ticks = Math.round(share * 20);
  const ceilingMeta = summary && !summary.unlimited && summary.ceiling > 0
    ? t.ceilingShareMeta.replace('{n}', String(Math.round(share * 100))).replace('{held}', `${formatShekel(held)} ₪`)
    : t.heldMeta.replace('{held}', `${formatShekel(held)} ₪`);
  const pulse = overview?.pulse;
  const now: PulseTotals | undefined = pulse?.current;
  const before = pulse?.previous;
  const labels = pulse ? pulse.trend.map((point) => stepLabel(period, point.at)) : [];
  const periodName = period === 'day' ? t.periodToday : period === 'month' ? t.periodMonth : t.periodAll;
  const trend = (pick: (point: PulseTotals) => number, money: boolean, name: string, tone: 'accent' | 'success' = 'accent') => (pulse ? (
    <TrendLine
      values={pulse.trend.map(pick)}
      labels={labels}
      format={(value) => (money ? `${formatShekel(value)} ₪` : String(value))}
      label={`${name} · ${periodName}`}
      tone={tone}
    />
  ) : null);
  return (
    <section className={branch ? 'figure-band account-band branch' : 'figure-band account-band'} aria-label={t.homeTitle}>
      {/* The branch's band is the period's three figures: no available balance, no active numbers (spec
          2026-11-09-admin-review, 6.3; the numbers are in the donut below). */}
      {branch ? null : <div className="figure-tile lead">
        <span className="figure-tile-label">{t.homeAvailable}</span>
        <div className="figure-tile-value">{summary ? <Money value={available} /> : '—'}</div>
        {summary && !summary.unlimited && summary.ceiling > 0 ? (
          <div className="hero-bar" role="img" aria-label={ceilingMeta}>
            {Array.from({ length: 20 }, (_, index) => <i key={index} className={index < ticks ? 'on' : undefined} />)}
          </div>
        ) : null}
        <div className="figure-tile-meta">{summary ? ceilingMeta : null}</div>
      </div>}
      <div className="figure-tile pulse-tile">
        <span className="figure-tile-label">{t.homeSales}</span>
        {now ? <Change now={now.amount} before={before?.amount} period={period} /> : null}
        <div className="figure-tile-value"><span className="num">{now ? now.count : '—'}</span><small className="pulse-unit">{t.operationsUnit}</small></div>
        <div className="figure-tile-meta">{now ? <>{t.volumeWord} <Money value={now.amount} /></> : null}</div>
        {trend((point) => point.amount, true, t.homeSales)}
      </div>
      <div className="figure-tile pulse-tile">
        <span className="figure-tile-label">{t.homeNewSubscriptions}</span>
        {now ? <Change now={now.activations} before={before?.activations} period={period} /> : null}
        <div className="figure-tile-value"><span className="num">{now ? now.activations : '—'}</span></div>
        <div className="figure-tile-meta">{periodName}</div>
        {trend((point) => point.activations, false, t.homeNewSubscriptions, 'success')}
      </div>
      <div className="figure-tile pulse-tile">
        <span className="figure-tile-label">{t.homeProfit}</span>
        {now ? <Change now={now.profit} before={before?.profit} period={period} /> : null}
        <div className="figure-tile-value">{now ? <Money value={now.profit} signed /> : '—'}</div>
        <div className="figure-tile-meta">{periodName}</div>
        {trend((point) => point.profit, true, t.homeProfit, 'success')}
      </div>
      {branch ? null : <div className="figure-tile">
        <span className="figure-tile-label">{t.homeActiveLines}</span>
        <div className="figure-tile-value"><span className="num">{home ? home.activeLines : '—'}</span></div>
        <div className="figure-tile-meta">
          {home ? <><span className={home.expiringLines ? 'tone-accent' : undefined}>{t.expiringMeta.replace('{n}', String(home.expiringLines))}</span> · <Link className="row-link" href="/numbers?status=expiring">{t.showThem}</Link></> : null}
        </div>
      </div>}
    </section>
  );
}

type Movement = HomePayload['operations'][number];

export function LastOperations({ home, failed, onRetry, showAccount }: { home: HomePayload | null | undefined; failed: string; onRetry: () => void; showAccount: boolean }) {
  const { t } = usePrefs();
  const head = (
    <header className="pane-head">
      <h2>{t.lastOps}</h2>
      <Link className={buttonClass({ variant: 'ghost', size: 'sm' })} href="/finance?scope=operations">{t.allOperations}</Link>
    </header>
  );
  if (!home) {
    return (
      <section className="pane home-ops">
        {head}
        {failed ? <LoadFailed message={failed} onRetry={onRetry} /> : <TableSkeleton rows={5} columns={3} />}
      </section>
    );
  }
  return (
    <section className="pane home-ops">
      {head}
      {home.operations.length === 0 ? (
        <EmptyState>{t.noMovements}</EmptyState>
      ) : (
        <ul className="op-list">
          {home.operations.slice(0, 6).map((row: Movement) => (
            <li key={row.id}>
              <span className="op-list-main">
                <strong>{actionName(t, row.kind)}</strong>
                {showAccount ? <span className="sub"><AccountName login={row.loginName} /></span> : null}
              </span>
              <span className="op-list-detail">{row.packageName || row.note || '—'}</span>
              <span className="op-list-end">
                <Money value={row.amount} />
                <span className="sub" dir="ltr">{latinWhen(row.at).slice(11)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WaitingTasks({ tasks, open, loading }: { tasks: TaskRow[]; open: number; loading: boolean }) {
  const { t } = usePrefs();
  return (
    <section className="pane home-waiting">
      <header className="pane-head">
        <h2>{t.tasksWaiting}</h2>
        {loading ? <Spinner /> : <span className="hint">{t.openMeta.replace('{n}', String(open))}</span>}
      </header>
      <div className="pane-body">
        {loading ? <TableSkeleton rows={3} columns={1} /> : tasks.length === 0 ? (
          <EmptyState>{t.noWaitingTasks}</EmptyState>
        ) : (
          <ul className="waiting-list">
            {tasks.slice(0, 4).map((task) => (
              <li key={task.id}>
                <Link href={`/tasks/${task.id}`}>
                  <span className="task-mark" aria-hidden="true"><Zap size={16} /></span>
                  <span className="waiting-main">
                    <strong>{actionName(t, task.action)}</strong>
                    <span className="sub"><bdi dir="ltr">{task.msisdn ?? '—'}</bdi> · <AccountName login={task.posLoginName} /></span>
                    {task.packageName ? <span className="sub">{task.packageName}</span> : null}
                  </span>
                  {task.createdAt ? <span className="sub waiting-age">{noticeAge(t, task.createdAt)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
