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
import { Tabs } from '../../../components/tabs';
import { ActiveCard, LinesCard, ProvidersCard, SalesCard, TasksCard, TopCard, UsersCard } from '../overview';
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
  // The full picture (spec 2026-11-08-overview-and-reports-nav, F): one read per period, kept per period in the cache.
  const [period, setPeriod] = useState<'day' | 'month' | 'all'>('month');
  const overview = useApiQuery(sharedKeys.overview(period), () => api.officeOverview(period));
  const home = board.data;
  const { run } = useAction({ setError, setNote, onDone: board.reload });
  // A failed board is shown once, in its panes; the banner is for actions.
  const failure = error;
  const broken = !home && Boolean(board.error);

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
        <div>
          <h1>{t.homeTitle}</h1>
          {layer && <p className="lede">{layerName(t, layer)}</p>}
        </div>
        <div className="page-actions">
          <Tabs
            label={t.period}
            items={[{ key: 'day', label: t.periodToday }, { key: 'month', label: t.periodMonth }, { key: 'all', label: t.periodAll }]}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </header>
      {/* Provider alerts (spec G): the same rule as the notices, shown while it holds. */}
      {overview.data?.providers?.some((row) => row.status === 'problem') ? (
        <Alert banner>
          {`${t.providerAlertBanner} ${overview.data.providers.filter((row) => row.status === 'problem').map((row) => `${row.name} (${row.problem === 'failures' ? t.providerProblemFailures.replace('{n}', String(row.failures)) : t.providerProblemBalance})`).join('، ')}`}
        </Alert>
      ) : null}
      <section className="overview" aria-busy={!overview.data && !overview.error}>
        {overview.error && !overview.data ? (
          <section className="pane"><LoadFailed message={overview.error} onRetry={() => void overview.reload()} /></section>
        ) : !overview.data ? (
          <div className="overview-grid">
            <section className="pane overview-card wide"><TableSkeleton rows={2} columns={5} /></section>
            <section className="pane overview-card"><TableSkeleton rows={5} columns={2} /></section>
            <section className="pane overview-card"><TableSkeleton rows={5} columns={2} /></section>
          </div>
        ) : (
          <div className="overview-grid">
            <SalesCard data={overview.data} />
            <LinesCard data={overview.data} />
            <TasksCard data={overview.data} />
            <ProvidersCard data={overview.data} />
            <TopCard data={overview.data} />
            {layer !== 'pos' ? <UsersCard data={overview.data} layer={layer} /> : null}
            {layer !== 'pos' ? <ActiveCard data={overview.data} layer={layer} /> : null}
          </div>
        )}
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
