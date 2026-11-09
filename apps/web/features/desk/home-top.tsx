'use client';

import { Zap } from 'lucide-react';
import Link from 'next/link';
import { AccountName } from '../../components/account-name';
import { Money, actionName, latinWhen } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { LoadFailed } from '../../components/load-failed';
import { Spinner, TableSkeleton } from '../../components/loading';
import type { FinanceSummary, HomePayload, TaskRow } from '../../lib/api';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';

/**
 * The top of the home page as in the approved Graphite design: the account's own figures — the available balance with
 * its ceiling as twenty ticks, the active numbers, the numbers ending within three days, the profit of the last 30
 * days — then the last operations beside the tasks waiting.
 */
export function AccountBand({ summary, home }: { summary: FinanceSummary | null | undefined; home: HomePayload | null | undefined }) {
  const { t } = usePrefs();
  const held = summary?.held ?? 0;
  const available = summary ? (summary.unlimited ? summary.balance : summary.balance + summary.ceiling - held) : 0;
  const used = summary && !summary.unlimited && summary.ceiling > 0 ? Math.max(0, -summary.balance) + held : 0;
  const share = summary && !summary.unlimited && summary.ceiling > 0 ? Math.min(1, used / summary.ceiling) : 0;
  const ticks = Math.round(share * 20);
  const ceilingMeta = summary && !summary.unlimited && summary.ceiling > 0
    ? t.ceilingShareMeta.replace('{n}', String(Math.round(share * 100))).replace('{held}', `${formatShekel(held)} ₪`)
    : t.heldMeta.replace('{held}', `${formatShekel(held)} ₪`);
  return (
    <section className="figure-band account-band" aria-label={t.homeTitle}>
      <div className="figure-tile lead">
        <span className="figure-tile-label">{t.homeAvailable}</span>
        <div className="figure-tile-value">{summary ? <Money value={available} /> : '—'}</div>
        {summary && !summary.unlimited && summary.ceiling > 0 ? (
          <div className="hero-bar" role="img" aria-label={t.ceilingShareMeta.replace('{n}', String(Math.round(share * 100))).replace('{held}', `${formatShekel(held)} ₪`)}>
            {Array.from({ length: 20 }, (_, index) => <i key={index} className={index < ticks ? 'on' : undefined} />)}
          </div>
        ) : null}
        <div className="figure-tile-meta">{summary ? ceilingMeta : null}</div>
      </div>
      <div className="figure-tile">
        <span className="figure-tile-label">{t.homeActiveLines}</span>
        <div className="figure-tile-value"><span className="num">{home ? home.activeLines : '—'}</span></div>
        <div className="figure-tile-meta">{home ? t.inactiveMeta.replace('{n}', String(home.inactiveLines)) : null}</div>
      </div>
      <div className="figure-tile">
        <span className="figure-tile-label">{t.homeExpiring}</span>
        <div className="figure-tile-value"><span className="num tone-accent">{home ? home.expiringLines : '—'}</span></div>
        <div className="figure-tile-meta"><Link className="row-link" href="/numbers?status=expiring">{t.showThem}</Link></div>
      </div>
      <div className="figure-tile">
        <span className="figure-tile-label">{t.homeProfit30}</span>
        <div className="figure-tile-value">{summary ? <Money value={summary.profit} signed /> : '—'}</div>
        <div className="figure-tile-meta">{summary ? t.salesCountMeta.replace('{n}', String(summary.sales)) : null}</div>
      </div>
    </section>
  );
}

type Movement = HomePayload['operations'][number];

export function LastOperations({ home, failed, onRetry, showAccount }: { home: HomePayload | null | undefined; failed: string; onRetry: () => void; showAccount: boolean }) {
  const { t } = usePrefs();
  const head = (
    <header className="pane-head">
      <h2>{t.lastOps}</h2>
      <Link className="ui-btn ui-btn-ghost ui-btn-sm" href="/reports/sales">{t.allSales}</Link>
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
                    <span className="sub"><bdi dir="ltr">{task.msisdn ?? '—'}</bdi> · <AccountName login={task.posLogin} /></span>
                    {task.packageName ? <span className="sub">{task.packageName}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
