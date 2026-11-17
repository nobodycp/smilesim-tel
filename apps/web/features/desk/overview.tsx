'use client';

import { Network, Store, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { DataTable } from '../../components/data-table';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money, Pane } from '../../components/desk';
import { Donut } from '../../components/donut';
import { EmptyState } from '../../components/empty-state';
import { Tabs } from '../../components/tabs';
import { Badge } from '../../components/ui/badge';
import type { OverviewPayload, OverviewRanked } from '../../lib/api';
import { cn } from '../../lib/cn';
import { usePrefs } from '../../lib/prefs';
import { PANE_BODY, PANE_HEAD, PANE_HINT, PANE_TITLE } from './home-panes';

// The home page's overview cards (spec 2026-11-08-overview-and-reports-nav, F). Each card draws only what the
// overview answered for this viewer: a layer without providers or main agents simply gets no such card or tab.

// A card's tab strip in its head stays inside the card and scrolls sideways on phones too.
const CARD_TABS = 'max-sm:max-w-full max-sm:overflow-x-auto';

/*
 * An overview card: a pane whose head wraps (the
 * title and its hint at the start, the tab strip at the end, 8px apart) and whose body is the positioning context of
 * what it draws. In the home page's narrow column it is the container its donut asks (screens/home-screen.tsx).
 */
function Card({ title, hint, action, children, testId = 'overview-card' }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Pane className="relative" data-testid={testId}>
      <header className={cn(PANE_HEAD, 'flex-wrap')}>
        <div>
          <h2 className={PANE_TITLE}>{title}</h2>
          {hint ? <p className={PANE_HINT}>{hint}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn(PANE_BODY, 'relative')}>{children}</div>
    </Pane>
  );
}

/*
 * The meters: a list of rows 4px
 * apart that start at the top of a stretched card; the bar 8px high, a pill of `--rd-surface-2` holding a pill of
 * its tone (`--rd-muted` unless success, warning or danger), which grows from the reading start over 700ms after
 * 150ms when motion is allowed.
 */
const METER_LIST = 'm-0 grid list-none content-start gap-1 p-0';
const METER = 'block h-2 overflow-hidden rounded-pill bg-surface-2';
const FILL = 'block h-full rounded-pill motion-safe:origin-left motion-safe:rtl:origin-right motion-safe:animate-[rd-grow_700ms_150ms_var(--rd-ease-out)_both]';
const FILL_TONE: Record<'warning' | 'info' | 'success' | 'danger' | 'muted', string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-muted',
  muted: 'bg-muted',
};

export function LinesCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const { lines } = data;
  const change = data.lineChange ?? null;
  const total = lines.active + lines.expiring + lines.frozen + lines.disconnected + lines.suspended;
  return (
    <Card title={t.overviewLines} hint={t.overviewLinesHint}>
      <Donut
        label={t.overviewLines}
        total={String(total)}
        slices={[
          { key: 'active', label: t.lineActive, value: lines.active, tone: '--rd-success', href: '/numbers?status=active', change: change?.active },
          { key: 'expiring', label: t.expiringSoon, value: lines.expiring, tone: '--rd-warning', href: '/numbers?status=expiring', change: change?.expiring },
          { key: 'frozen', label: t.lineFrozen, value: lines.frozen, tone: '--rd-chart-frozen', href: '/numbers?status=frozen', change: change?.frozen },
          { key: 'suspended', label: t.lineSuspended, value: lines.suspended, tone: '--rd-chart-suspended', href: '/numbers?status=suspended', change: change?.suspended },
          { key: 'disconnected', label: t.lineDisconnected, value: lines.disconnected, tone: '--rd-danger', href: '/numbers?status=disconnected', change: change?.disconnected },
        ]}
      />
    </Card>
  );
}

export function TasksCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const { tasks } = data;
  const rows: { key: string; label: string; value: number; tone: 'warning' | 'info' | 'success' | 'danger' | 'muted'; href: string }[] = [
    // Three statuses (spec 2026-11-09, 2): in progress, closed, done.
    { key: 'working', label: t.working, value: tasks.working, tone: 'warning', href: '/tasks?status=working' },
    { key: 'closed', label: t.taskClosed, value: tasks.rejected + tasks.cancelled, tone: 'muted', href: '/tasks?status=cancelled' },
    { key: 'done', label: t.done, value: tasks.done, tone: 'success', href: '/tasks?status=done' },
  ];
  const all = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  const age = tasks.oldestOpenMinutes;
  const ageText = age === null ? t.noOpenTasks : t.oldestOpenTask.replace('{time}', (age < 60 ? t.minutesAgo.replace('{n}', String(age)) : age < 1440 ? t.hoursAgo.replace('{n}', String(Math.floor(age / 60))) : t.daysAgo.replace('{n}', String(Math.floor(age / 1440)))));
  return (
    <Card title={t.overviewTasks} hint={ageText}>
      <ul className={METER_LIST}>
        {rows.map((row) => (
          <li key={row.key}>
            {/* A row: the status, its bar and its count, 12px apart; 6px / 8px padding, 6px corners, ink, on
                `--rd-surface-2` under the pointer. */}
            <Link className="grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-3 rounded-sm px-2 py-1.5 text-ink hover:bg-surface-2" href={row.href}>
              <Badge variant={row.tone === 'info' ? 'muted' : row.tone} dot>{row.label}</Badge>
              <span className={METER} aria-hidden="true"><span className={cn(FILL, FILL_TONE[row.tone])} style={{ inlineSize: `${(row.value / all) * 100}%` }} /></span>
              <span>{row.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProvidersCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  if (!data.providers) return null;
  return (
    <Card title={t.overviewProviders} hint={t.overviewProvidersHint}>
      {data.providers.length === 0 ? <EmptyState>{t.overviewEmpty}</EmptyState> : (
        // The office's table (owner 2026-11-11): every header sorts, as on every list.
        <DataTable
          bare
          paginate={false}
          rows={data.providers}
          rowKey={(row) => row.code}
          columns={[
            { key: 'name', header: t.provider, render: (row) => <Link href={`/provider-accounts/${encodeURIComponent(row.code)}`}>{row.name}</Link> },
            {
              key: 'status',
              header: t.status,
              sortValue: (row) => (row.status === 'working' ? 1 : 0),
              render: (row) => (
                <Badge variant={row.status === 'working' ? 'success' : 'danger'} dot title={row.problem === 'balance' ? t.providerProblemBalance : row.problem === 'failures' ? t.providerProblemFailures.replace('{n}', String(row.failures)) : undefined}>
                  {row.status === 'working' ? t.providerWorking : t.providerProblem}
                </Badge>
              ),
            },
            { key: 'ops', header: t.lineOps, num: true, sortValue: (row) => row.operations, render: (row) => row.operations },
            { key: 'cost', header: t.providerConsumption, num: true, sortValue: (row) => row.cost, render: (row) => <Money value={row.cost} /> },
            { key: 'balance', header: t.balance, num: true, sortValue: (row) => row.balance, render: (row) => <Money value={row.balance} /> },
            { key: 'available', header: t.providerAvailable, num: true, sortValue: (row) => row.available, render: (row) => <Money value={row.available} /> },
          ]}
        />
      )}
    </Card>
  );
}

function RankedList({ rows, by }: { rows: OverviewRanked[]; by: 'count' | 'profit' }) {
  const { t } = usePrefs();
  if (rows.length === 0) return <EmptyState>{t.overviewEmpty}</EmptyState>;
  const high = Math.max(1, ...rows.map((row) => Math.abs(row[by])));
  return (
    <ol className={METER_LIST} data-testid="overview-rank">
      {rows.map((row, index) => (
        // A row: its place (`--rd-muted` bold), the name (bold, cut with an ellipsis), the bar and the figure at the
        // end, 10px apart, 6px padding, a 1px `--rd-line-soft` rule under every row but the last.
        <li key={row.key || index} className="grid grid-cols-[1.5rem_minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line-soft py-1.5 last:border-b-0">
          <span className="font-bold text-muted">{index + 1}</span>
          <span className="truncate font-bold">{row.nickname !== undefined ? <AccountName login={row.label} name={row.nickname} /> : row.label}</span>
          <span className={METER} aria-hidden="true"><span className={cn(FILL, FILL_TONE.success)} style={{ inlineSize: `${(Math.abs(row[by]) / high) * 100}%` }} /></span>
          <span className="text-end whitespace-nowrap">
            {by === 'count' ? <span>{t.salesCountShort.replace('{n}', String(row.count))}</span> : <Money value={row.profit} signed />}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TopCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const tabs = [
    { key: 'packages', label: t.topPackages },
    { key: 'companies', label: t.topCompanies },
    ...(data.providers ? [{ key: 'providers', label: t.topProviders }] : []),
  ];
  const [tab, setTab] = useState('packages');
  return (
    <Card title={t.overviewTop} action={<Tabs items={tabs} value={tab} onChange={setTab} className={CARD_TABS} />}>
      {tab === 'packages' && <RankedList rows={data.top.packages} by="count" />}
      {tab === 'companies' && <RankedList rows={data.top.companies} by="profit" />}
      {tab === 'providers' && <RankedList rows={data.top.providers} by="profit" />}
    </Card>
  );
}

/*
 * «المستخدمون»: a tile per layer in its colour (`--tone`), as many 96px-or-wider
 * columns as fit, 8px apart; each tile its mark and count over its name (6px / 8px apart), 10px / 12px padding, 6px
 * corners, the tone at 8% over the card's `--rd-surface` with a 1px inset edge of the tone at 18% (45% under the
 * pointer), a 2px outline of the tone 2px out on keyboard focus. The mark 28px, 6px corners, the tone on itself at
 * 16%; the count 16px extra bold, the name 11px `--rd-muted` 600. Then the ceilings in use, 16px under: their name and
 * figure (12px `--rd-muted`, the figure ink bold), an 8px pill of `--rd-surface-2` holding the share in `--rd-accent`
 * (it grows in over 700ms when motion is allowed), the ceilings' total and the share (11px `--rd-muted`). Then the
 * debtors and the frozen accounts as two rows 12px under, 8px padding, a 1px `--rd-line` rule above each, 12px; the
 * debtors' count a 20px pill (`--rd-surface-2`, ink, 11px bold), count and debt in `--rd-warning` (the pill on its
 * soft fill) while there are debtors (`data-warn`).
 */
const USERS_LAYER = cn(
  "grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 rounded-sm bg-(--tone)/8 px-3 py-2.5 text-ink no-underline [grid-template-areas:'mark_count'_'label_label']",
  'inset-ring inset-ring-(--tone)/18 hover:inset-ring-(--tone)/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tone)',
  'transition-[box-shadow,transform] duration-fast ease-out',
);
const USERS_FLAG = 'flex items-center justify-between gap-3 border-t border-line py-2 text-sm';
const FLAG_COUNT = 'inline-grid h-5 min-w-5 place-items-center rounded-pill px-1.25 text-xs font-bold';

export function UsersCard({ data, layer }: { data: OverviewPayload; layer: string }) {
  const { t } = usePrefs();
  const { users } = data;
  // One tile per layer this viewer manages, then the credit picture (spec 2026-11-09-admin-review, 8.3).
  const layers = [
    ...(layer === 'branch' ? [{ key: 'main_agent', label: t.activeMainAgents, value: users.counts.main_agent, tone: '--rd-layer-main', icon: <Network size={16} /> }] : []),
    ...(layer === 'branch' || layer === 'main_agent' ? [{ key: 'agent', label: t.activeAgents, value: users.counts.agent, tone: '--rd-layer-agent', icon: <UsersRound size={16} /> }] : []),
    { key: 'pos', label: t.activePos, value: users.counts.pos, tone: '--rd-layer-pos', icon: <Store size={16} /> },
  ];
  const usedShare = users.ceilings > 0 ? Math.min(100, Math.round((users.used / users.ceilings) * 100)) : 0;
  return (
    <Card title={t.overviewUsers} testId="users-card">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
        {layers.map((item) => (
          <Link key={item.key} className={USERS_LAYER} data-testid="users-layer" href={`/users?layer=${item.key}`} style={{ ['--tone' as string]: `var(${item.tone})` }}>
            <span className="inline-grid size-7 place-items-center rounded-sm bg-(--tone)/16 text-(--tone) [grid-area:mark]" aria-hidden="true">{item.icon}</span>
            <span className="justify-self-end text-xl leading-none font-bold [grid-area:count]">{item.value}</span>
            <span className="text-xs leading-1-35 font-semibold text-muted [grid-area:label]">{item.label}</span>
          </Link>
        ))}
      </div>
      <div className="mt-4 grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{t.usedCeiling}</span>
          <span className="font-bold whitespace-nowrap text-ink"><Money value={users.used} /></span>
        </div>
        <div className="h-2 overflow-hidden rounded-pill bg-surface-2" data-testid="users-meter" role="img" aria-label={`${t.usedCeiling}: ${usedShare}%`}>
          <i className="block h-full rounded-[inherit] bg-accent motion-safe:animate-[users-fill_700ms_var(--rd-ease-out)_both]" style={{ inlineSize: `${usedShare}%` }} />
        </div>
        <p className="m-0 flex justify-between gap-2 text-xs text-muted"><span>{t.usersCeilings} <Money value={users.ceilings} /></span><span>{usedShare}%</span></p>
      </div>
      <ul className="mx-0 mt-3 mb-0 grid list-none p-0">
        <li className={USERS_FLAG} data-testid="users-debtors" data-warn={users.debtors ? '' : undefined}>
          <span className="inline-flex items-center gap-1.5 text-muted">{t.usersDebtors} <span className={cn(FLAG_COUNT, users.debtors ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-ink')}>{users.debtors}</span></span>
          <span className={cn('font-bold', users.debtors ? 'text-warning' : undefined)} title={t.usersDebt}><Money value={users.debt} /></span>
        </li>
        <li className={USERS_FLAG}>
          <span className="inline-flex items-center gap-1.5 text-muted">{t.usersFrozen}</span>
          <span className="font-bold">{users.frozen}</span>
        </li>
      </ul>
    </Card>
  );
}

export function ActiveCard({ data, layer }: { data: OverviewPayload; layer: string }) {
  const { t } = usePrefs();
  const tabs = [
    ...(layer === 'branch' ? [{ key: 'main_agent', label: t.activeMainAgents }] : []),
    ...(layer === 'branch' || layer === 'main_agent' ? [{ key: 'agent', label: t.activeAgents }] : []),
    ...(layer !== 'pos' ? [{ key: 'pos', label: t.activePos }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.key ?? 'pos');
  if (tabs.length === 0) return null;
  const rows = data.active[tab as keyof OverviewPayload['active']] ?? [];
  return (
    <Card title={t.overviewActive} action={tabs.length > 1 ? <Tabs items={tabs} value={tab} onChange={setTab} className={CARD_TABS} /> : undefined}>
      <RankedList rows={rows} by="count" />
    </Card>
  );
}
