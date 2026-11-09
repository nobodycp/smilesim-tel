'use client';

import { useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import Link from 'next/link';
import { layerName } from '../../../components/desk';
import type { IconName } from '../../../components/icon';
import { LoadFailed } from '../../../components/load-failed';
import { PageSkeleton, TableSkeleton } from '../../../components/loading';
import { Tabs } from '../../../components/tabs';
import { OfferHero } from '../../../components/offer-hero';
import { AccountBand, LastOperations, WaitingTasks } from '../home-top';
import { ActiveCard, LinesCard, ProvidersCard, ShortcutsCard, TasksCard, TopCard, UsersCard } from '../overview';
import { api } from '../../../lib/api';
import { useOffice } from '../../../lib/office-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { useGreeting } from '../../../lib/greeting';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { Alert } from '../../../components/alert';
import { buttonClass } from '../../../components/ui/button';

export function HomeScreen() {
  const { t, locale } = usePrefs();
  const { ready, me } = useOffice();
  const greeting = useGreeting();
  usePageTitle(t.homeTitle);
  const layer = me?.layer ?? '';
  const board = useApiQuery(sharedKeys.home, () => api.officeHome());
  // The full picture (spec 2026-11-08-overview-and-reports-nav, F): one read per period, kept per period in the cache.
  const [period, setPeriod] = useState<'day' | 'month' | 'all'>('month');
  const overview = useApiQuery(sharedKeys.overview(period), () => api.officeOverview(period));
  // The offers hero (spec 2026-11-09, 1): the live offers for this account's layer, first on the page.
  const offers = useApiQuery(sharedKeys.liveOffers, () => api.liveOffers()).data?.offers ?? [];
  const home = board.data;
  // The design's top: the account's own wallet, and the tasks waiting for it.
  const summary = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary());
  const waiting = useApiQuery(['office', 'tasks', 'home-waiting'], () => api.officeTasks({ status: 'working' }));
  // A failed board is shown once, in its panes.
  const broken = !home && Boolean(board.error);

  const shortcuts: { href: string; label: string; icon: IconName }[] = layer === 'pos'
    ? [
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/packages', label: t.navPlans, icon: 'plans' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        { href: '/finance', label: t.navFinance, icon: 'wallet' },
        { href: '/wallet', label: t.walletPage, icon: 'wallet' },
        { href: '/profits', label: t.navProfits, icon: 'reports' },
      ]
    : [
        { href: '/users', label: t.navUsers, icon: 'staff' },
        ...(me?.isBranchOwner ? [{ href: '/roles', label: t.navRoles, icon: 'lock' as const }] : []),
        // The branch reaches packages through their companies (spec 2026-11-09-admin-review, 4).
        ...(layer === 'branch' ? [] : [{ href: '/packages', label: t.navPlans, icon: 'plans' as const }]),
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        ...(layer === 'branch' ? [{ href: '/companies', label: t.navCompanies, icon: 'providers' as const }] : []),
        ...(me?.isBranchOwner ? [] : [{ href: '/profits', label: t.navProfits, icon: 'reports' as const }]),
      ];
  // The head (Graphite, as in the approved design): the greeting is the title, today's date and the layer the lede.
  const name = me ? me.nickname || me.loginName : '';
  const title = greeting && name ? `${greeting.hello}${locale === 'en' ? ',' : '،'} ${name}` : t.homeTitle;
  const waitingLede = home ? t.homeWaitingLede.replace('{tasks}', String(home.openTasks)).replace('{lines}', String(home.expiringLines)) : '';
  const lede = [greeting?.today, waitingLede || (layer ? layerName(t, layer) : '')].filter(Boolean).join(' · ');
  const data = overview.data;
  const loadingOverview = !data && !overview.error;

  if (!ready) return <PageSkeleton />;

  return (
    <div className="home">
      <header className="page-head home-head">
        <div>
          <h1><bdi>{title}</bdi></h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        <div className="page-actions">
          {/* The period every card of the page follows (owner 2026-11-09). */}
          <Tabs
            label={t.period}
            items={[{ key: 'day', label: t.periodToday }, { key: 'month', label: t.periodMonth }, { key: 'all', label: t.periodAll }]}
            value={period}
            onChange={setPeriod}
          />
          {layer && layer !== 'pos' ? (
            <Link className={buttonClass({ variant: 'outline' })} href="/users"><Receipt size={16} aria-hidden="true" />{t.fundAccount}</Link>
          ) : null}
          <Link className={`${buttonClass()} ui-btn-accent`} href="/numbers"><Plus size={16} aria-hidden="true" />{t.activateLine}</Link>
        </div>
      </header>
      {offers.length > 0 ? <OfferHero offers={offers} /> : null}
      {/* Provider alerts (spec G): the same rule as the notices, shown while it holds. */}
      {data?.providers?.some((row) => row.status === 'problem') ? (
        <Alert banner>
          {`${t.providerAlertBanner} ${data.providers.filter((row) => row.status === 'problem').map((row) => `${row.name} (${row.problem === 'failures' ? t.providerProblemFailures.replace('{n}', String(row.failures)) : t.providerProblemBalance})`).join('، ')}`}
        </Alert>
      ) : null}
      <AccountBand summary={summary.data} home={home} overview={data} period={period} />
      <div className="home-top-row">
        <LastOperations home={home} failed={broken ? board.error : ''} onRetry={() => void board.reload()} showAccount={layer !== 'pos'} />
        <WaitingTasks tasks={waiting.data?.tasks ?? []} open={home?.openTasks ?? waiting.data?.total ?? 0} loading={!waiting.data && !waiting.error} />
      </div>
      {/* Below the design's top, the rest of the period's overview (spec 2026-11-08-overview-and-reports-nav, F). */}
      <header className="section-head home-overview-head"><h2>{t.overviewSection}</h2></header>
      {overview.error && !data ? <section className="pane"><LoadFailed message={overview.error} onRetry={() => void overview.reload()} /></section> : null}
      <div className="home-columns">
        <div className="home-side">
          {data ? <LinesCard data={data} /> : loadingOverview ? <section className="pane overview-card"><TableSkeleton rows={5} columns={2} /></section> : null}
          {data ? <TasksCard data={data} /> : null}
          {me ? <ShortcutsCard items={shortcuts} /> : null}
          {data && layer !== 'pos' ? <UsersCard data={data} layer={layer} /> : null}
        </div>
        <div className="home-main">
          {data ? <TopCard data={data} /> : null}
          {data && layer !== 'pos' ? <ActiveCard data={data} layer={layer} /> : null}
          {data ? <ProvidersCard data={data} /> : null}
        </div>
      </div>
    </div>
  );
}
