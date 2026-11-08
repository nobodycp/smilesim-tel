'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AccountName } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Money, actionName, latinWhen, layerName } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { Icon, type IconName } from '../../../components/icon';
import { LoadFailed } from '../../../components/load-failed';
import { PageSkeleton, Spinner, TableSkeleton } from '../../../components/loading';
import { Stat, StatRow } from '../../../components/stat';
import { api, type HomePayload } from '../../../lib/api';
import { useOffice } from '../../../lib/office-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { Alert } from '../../../components/alert';
import { Button } from '../../../components/ui/button';

type Movement = HomePayload['operations'][number];

export function HomeScreen() {
  const { t } = usePrefs();
  const { ready, me } = useOffice();
  usePageTitle(t.homeTitle);
  const layer = me?.layer ?? '';
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const board = useApiQuery(sharedKeys.home, () => api.officeHome());
  // What this account earned over 30 days: the finance page's own figure, shared from its cache.
  const profit = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary()).data ?? null;
  const home = board.data;
  const { run } = useAction({ setError, setNote, onDone: board.reload });
  // A failed board is shown once, in its panes; the banner is for actions.
  const failure = error;
  const broken = !home && Boolean(board.error);
  const dash = <span className="stat-dash" aria-hidden="true">—</span>;

  async function publish(event: FormEvent) {
    event.preventDefault();
    await run(() => api.postAnnouncement(draft), { note: t.posted, then: () => setDraft('') });
  }

  const movementColumns: Column<Movement>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'movement', header: t.movement, render: (row) => {
      const detail = row.packageName || row.note;
      return `${actionName(t, row.kind)}${detail ? ` · ${detail}` : ''}`;
    } },
    ...(layer === 'pos' ? [] : [{ key: 'pos', header: t.pointOfSale, render: (row: Movement) => <AccountName login={row.loginName} /> }]),
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} /> },
  ];

  const shortcuts: { href: string; label: string; icon: IconName }[] = layer === 'pos'
    ? [
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/packages', label: t.navPlans, icon: 'plans' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        { href: '/finance', label: t.navFinance, icon: 'wallet' },
      ]
    : [
        { href: '/users', label: t.navUsers, icon: 'staff' },
        ...(me?.isBranchOwner ? [{ href: '/roles', label: t.navRoles, icon: 'lock' as const }] : []),
        { href: '/packages', label: t.navPlans, icon: 'plans' },
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        ...(layer === 'branch' ? [{ href: '/companies', label: t.navCompanies, icon: 'providers' as const }] : []),
      ];

  if (!ready) return <PageSkeleton />;

  return (
    <div className="home">
      <Alert banner>{failure}</Alert>
      <Alert tone="success" banner>{note}</Alert>
      <header className="page-head">
        <h1>{t.homeTitle}</h1>
        {layer && <p className="lede">{layerName(t, layer)}</p>}
      </header>
      <section className="home-access">
        <p className="section-label">{t.quickAccess}</p>
        {/* Stat stays presentational so non-link KPIs can reuse it; the link wraps it here. */}
        <StatRow>
          <Link className="stat-link" href="/tasks?status=pending">
            <Stat icon="tasks" tone="warning" label={t.navTasks} value={home ? home.pendingTasks : broken ? dash : <span className="skeleton sk-num" />} meta={t.pending} />
          </Link>
          <Link className="stat-link" href="/numbers?status=active">
            <Stat icon="numbers" tone="success" label={t.activeLines} value={home ? home.activeLines : broken ? dash : <span className="skeleton sk-num" />} meta={t.lineActive} />
          </Link>
          <Link className="stat-link" href="/finance">
            <Stat icon="reports" tone="success" label={t.myProfit30} value={profit ? <Money value={profit.profit} signed /> : <span className="skeleton sk-num" />} meta={profit ? t.salesCount.replace('{n}', String(profit.sales)) : undefined} />
          </Link>
          <Link className="stat-link" href="/numbers?status=expiring">
            <Stat icon="numbers" tone="warning" label={t.expiringSoon} value={home ? home.expiringLines : broken ? dash : <span className="skeleton sk-num" />} meta={t.expiringSoonHint} />
          </Link>
          <Link className="stat-link" href="/numbers?status=disconnected">
            <Stat icon="numbers" tone="danger" label={t.inactiveLines} value={home ? home.inactiveLines : broken ? dash : <span className="skeleton sk-num" />} meta={t.lineDisconnected} />
          </Link>
        </StatRow>
      </section>
      {me && (
        <section>
          <p className="section-label">{t.shortcuts}</p>
          <div className="shortcut-row">
            {shortcuts.map((item) => (
              <Link key={item.label} className="shortcut" href={item.href}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="home-grid">
        {broken ? (
          <>
            <section className="pane">
              <header className="pane-head"><h2>{t.lastOps}</h2></header>
              <LoadFailed message={board.error} onRetry={() => void board.reload()} />
            </section>
            <section className="pane">
              <header className="pane-head"><h2>{t.board}</h2></header>
              <LoadFailed message={board.error} onRetry={() => void board.reload()} />
            </section>
          </>
        ) : !home ? (
          <>
            <section className="pane">
              <header className="pane-head"><h2>{t.lastOps}</h2><Spinner /></header>
              <TableSkeleton rows={5} columns={4} />
            </section>
            <section className="pane">
              <header className="pane-head"><h2>{t.board}</h2><Spinner /></header>
              <TableSkeleton rows={4} columns={1} />
            </section>
          </>
        ) : <>
        <section className="pane">
          <header className="pane-head">
            <h2>{t.lastOps}</h2>
          </header>
          <DataTable columns={movementColumns} rows={home.operations} rowKey={(row) => row.id} empty={t.noMovements} />
        </section>
        <section className="pane">
          <header className="pane-head">
            <h2>{t.board}</h2>
          </header>
          <div className="pane-body">
            {home.canPost && (
              <form onSubmit={publish}>
                <label>
                  {t.announcementText}
                  <textarea value={draft} maxLength={400} onChange={(event) => setDraft(event.target.value)} />
                </label>
                <p className="hint">{t.announcementHint}</p>
                <Button type="submit" disabled={!draft.trim()}>{t.postAnnouncement}</Button>
              </form>
            )}
            {home.announcements.length === 0 ? (
              <EmptyState>{t.noAnnouncements}</EmptyState>
            ) : (
              <ul className="notices">
                {home.announcements.map((row) => (
                  <li key={row.id}>
                    <p>{row.body}</p>
                    <small>
                      <bdi>{row.authorName}</bdi> · {layerName(t, row.authorLayer)} · <bdi dir="ltr">{latinWhen(row.at)}</bdi>
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </>}
      </div>
    </div>
  );
}
