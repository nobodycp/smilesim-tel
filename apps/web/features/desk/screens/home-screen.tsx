'use client';

import { useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import Link from 'next/link';
import { Pane, layerName } from '../../../components/desk';
import { LoadFailed } from '../../../components/load-failed';
import { PageSkeleton, TableSkeleton } from '../../../components/loading';
import { Tabs } from '../../../components/tabs';
import { OfferHero } from '../../../components/offer-hero';
import { AccountBand, LastOperations, WaitingTasks } from '../home-top';
import { ActiveCard, LinesCard, ProvidersCard, TasksCard, TopCard, UsersCard } from '../overview';
import { api } from '../../../lib/api';
import { useDesk } from '../../../lib/desk-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { listTotal } from '../../../lib/list-total';
import { useGreeting } from '../../../lib/greeting';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { Alert } from '../../../components/alert';
import { Button } from '../../../components/ui/button';
import { riseInClass } from '../../../components/stat';
import { cn } from '../../../lib/cn';

/*
 * The home page's frame:
 * - the page: a column 14px apart that fills the canvas; its parts rise in (8px, 420ms), the second to the fifth 40ms
 *   after the one before, when motion is allowed (`riseInClass`);
 * - the head: one wrapping row, the greeting and lede at the start and the actions at the end, 8px apart; the title
 *   1.25rem with no letter spacing (`.canvas .page-head h1` in app/tailwind.css; the `h1` element rule gives it no
 *   margin, bold, 1.25 line height); the lede 13px `--rd-muted`, no margin, at most 36rem; the actions a wrapping row 8px apart;
 * - the top row (last operations, tasks waiting): one column, 12px apart, rows at the top; 1.6fr and 1fr from 1000px;
 * - the two columns below, 14px apart, at the top: one on a phone; from 1100px the wide one (1.65fr) at the reading
 *   start and the narrow one (at least 320px) at the end. Each stacks its cards 14px apart from the top, never wider
 *   than itself, rising in as the page's parts do; between 640px and 1099px the narrow column's cards pair up. A card
 *   of the narrow column is the container its donut asks (`@container`); `data-slot="home-side"` is the column the
 *   donut reads (components/donut.tsx).
 */
const HOME = cn('flex flex-1 flex-col gap-3.5', riseInClass);
const COLUMN = cn('grid min-w-0 content-start gap-3.5 *:min-w-0', riseInClass);

export function HomeScreen() {
  const { t, locale } = usePrefs();
  const { ready, me } = useDesk();
  const greeting = useGreeting();
  usePageTitle(t.homeTitle);
  const layer = me?.layer ?? '';
  const board = useApiQuery(sharedKeys.home, () => api.home());
  // The full picture (spec 2026-11-08-overview-and-reports-nav, F): one read per period, kept per period in the cache.
  const [period, setPeriod] = useState<'day' | 'month' | 'all'>('month');
  const overview = useApiQuery(sharedKeys.overview(period), () => api.overview(period));
  // The offers hero (spec 2026-11-09, 1): the live offers for this account's layer, first on the page.
  const offers = useApiQuery(sharedKeys.liveOffers, () => api.liveOffers()).data?.offers ?? [];
  const home = board.data;
  // The design's top: the account's own wallet, and the tasks waiting for it.
  const summary = useApiQuery(sharedKeys.financeSummary, () => api.financeSummary());
  // The branch's home has no «مهام بانتظارك» and no «آخر العمليات» (spec 2026-11-09-admin-review, 6.3).
  const branch = layer === 'branch';
  const waiting = useApiQuery(['api', 'tasks', 'home-waiting'], () => api.tasks({ status: 'working' }), { enabled: Boolean(layer) && !branch });
  // A failed board is shown once, in its panes.
  const broken = !home && Boolean(board.error);

  // The head (Graphite, as in the approved design): the greeting is the title, today's date and the layer the lede.
  const name = me ? me.nickname || me.loginName : '';
  const title = greeting && name ? `${greeting.hello}${locale === 'en' ? ',' : '،'} ${name}` : t.homeTitle;
  const waitingLede = home ? t.homeWaitingLede.replace('{tasks}', String(home.openTasks)).replace('{lines}', String(home.expiringLines)) : '';
  const lede = [greeting?.today, waitingLede || (layer ? layerName(t, layer) : '')].filter(Boolean).join(' · ');
  const data = overview.data;
  const loadingOverview = !data && !overview.error;

  if (!ready) return <PageSkeleton />;

  return (
    <div className={HOME}>
      <header className="flex flex-wrap items-center justify-between gap-2" data-slot="page-head" data-testid="page-head">
        <div>
          <h1 className="m-0 text-page tracking-normal"><bdi>{title}</bdi></h1>
          {lede && <p className="m-0 max-w-144 text-md text-muted">{lede}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The period every card of the page follows (owner 2026-11-09). */}
          <Tabs
            label={t.period}
            items={[{ key: 'day', label: t.periodTabDay }, { key: 'month', label: t.periodTabMonth }, { key: 'all', label: t.periodTabAll }]}
            value={period}
            onChange={setPeriod}
          />
          {/* The branch's head carries the period alone (spec 2026-11-09-admin-review, 6.3). */}
          {layer && layer !== 'pos' && !branch ? (
            <Button asChild variant="secondary"><Link href="/users"><Receipt size={16} aria-hidden="true" />{t.fundAccount}</Link></Button>
          ) : null}
          {layer && !branch ? <Button asChild><Link href="/numbers"><Plus size={16} aria-hidden="true" />{t.activateLine}</Link></Button> : null}
        </div>
      </header>
      {offers.length > 0 ? <OfferHero offers={offers} /> : null}
      {/* Provider alerts (spec G): the same rule as the notices, shown while it holds. */}
      {data?.providers?.some((row) => row.status === 'problem') ? (
        <Alert banner>
          {`${t.providerAlertBanner} ${data.providers.filter((row) => row.status === 'problem').map((row) => `${row.name} (${row.problem === 'failures' ? t.providerProblemFailures.replace('{n}', String(row.failures)) : t.providerProblemBalance})`).join('، ')}`}
        </Alert>
      ) : null}
      <AccountBand summary={summary.data} home={home} overview={data} period={period} branch={branch} />
      {branch ? null : (
        <div className="grid grid-cols-1 items-start gap-3 min-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="home-top-row">
          <LastOperations home={home} failed={broken ? board.error : ''} onRetry={() => void board.reload()} showAccount={layer !== 'pos'} />
          <WaitingTasks tasks={waiting.data?.items ?? []} open={home ? String(home.openTasks) : waiting.data ? listTotal(t, waiting.data.total, waiting.data.totalCapped) : '0'} loading={!waiting.data && !waiting.error} />
        </div>
      )}
      {/* Below the design's top, the rest of the period's overview (spec 2026-11-08-overview-and-reports-nav, F), with
          no heading and no shortcuts card (spec 2026-11-09-admin-review, 7). */}
      {overview.error && !data ? <Pane><LoadFailed message={overview.error} onRetry={() => void overview.reload()} /></Pane> : null}
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <div className={cn(COLUMN, '*:@container sm:max-xl:grid-cols-2 sm:max-xl:items-stretch xl:col-start-2 xl:row-start-1')} data-slot="home-side">
          {data ? <LinesCard data={data} /> : loadingOverview ? <Pane className="relative" data-testid="overview-card"><TableSkeleton rows={5} columns={2} /></Pane> : null}
          {data ? <TasksCard data={data} /> : null}
          {data && layer !== 'pos' ? <UsersCard data={data} layer={layer} /> : null}
        </div>
        <div className={cn(COLUMN, 'xl:col-start-1 xl:row-start-1')}>
          {data ? <TopCard data={data} /> : null}
          {data && layer !== 'pos' ? <ActiveCard data={data} layer={layer} /> : null}
          {data ? <ProvidersCard data={data} /> : null}
        </div>
      </div>
    </div>
  );
}
