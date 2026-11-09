'use client';

import Link from 'next/link';
import { useState, type PointerEvent, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money } from '../../components/desk';
import { Donut } from '../../components/donut';
import { EmptyState } from '../../components/empty-state';
import { Fact, Facts } from '../../components/facts';
import { Icon, type IconName } from '../../components/icon';
import { Sparkline } from '../../components/sparkline';
import { Tabs } from '../../components/tabs';
import { Badge } from '../../components/ui/badge';
import type { OverviewPayload, OverviewRanked } from '../../lib/api';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';

// The home page's overview cards (spec 2026-11-08-overview-and-reports-nav, F). Each card draws only what the
// overview answered for this viewer: a layer without providers or main agents simply gets no such card or tab.

function Card({ title, hint, action, wide, children, className = '' }: { title: string; hint?: string; action?: ReactNode; wide?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`pane overview-card${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}>
      <header className="pane-head">
        <div>
          <h2>{title}</h2>
          {hint ? <p className="hint">{hint}</p> : null}
        </div>
        {action}
      </header>
      <div className="pane-body">{children}</div>
    </section>
  );
}

/** Moves the hover glow of a figure or shortcut tile to the pointer (CSS reads `--mx` / `--my`). */
export function followPointer(event: PointerEvent<HTMLElement>) {
  const tile = (event.target as HTMLElement).closest<HTMLElement>('.figure-tile, .shortcut-tile');
  if (!tile) return;
  const box = tile.getBoundingClientRect();
  tile.style.setProperty('--mx', `${event.clientX - box.left}px`);
  tile.style.setProperty('--my', `${event.clientY - box.top}px`);
}

function Tile({ label, icon, lead, tone, meta, children }: { label: string; icon: IconName; lead?: boolean; tone?: 'good'; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className={`figure-tile${lead ? ' lead' : ''}${tone ? ` ${tone}` : ''}`}>
      <div className="figure-tile-head">
        <span className="figure-tile-label">{label}</span>
        <span className="figure-tile-icon" aria-hidden="true"><Icon name={icon} /></span>
      </div>
      <div className="figure-tile-value">{children}</div>
      {meta ? <div className="figure-tile-meta">{meta}</div> : null}
    </div>
  );
}

/**
 * The figure band at the top of the home page (Graphite, spec 2026-11-09-graphite-identity): four cut-corner tiles —
 * sales (the lead, with the period's trend), my profit, net (refunds as its meta line) and the number of sales.
 */
export function FigureBand({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const { sales } = data;
  return (
    <section className="figure-band overview-sales" aria-label={t.overviewSales} onPointerMove={followPointer}>
      <Tile
        label={t.overviewSalesAmount}
        icon="reports"
        lead
        meta={
          <Sparkline
            values={sales.trend.map((point) => point.amount)}
            label={`${t.overviewTrend}: ${sales.trend.map((point) => `${point.day} ${(point.amount / 100).toFixed(2)}`).join(', ')}`}
          />
        }
      >
        <Money value={sales.amount} />
      </Tile>
      <Tile
        label={t.overviewMyProfit}
        icon="wallet"
        tone="good"
        meta={sales.amount > 0 ? <span className="num">{t.overviewMarginMeta.replace('{n}', ((sales.profit / sales.amount) * 100).toFixed(1))}</span> : null}
      >
        <Money value={sales.profit} signed />
      </Tile>
      <Tile
        label={t.overviewNet}
        icon="plans"
        meta={<>{t.overviewRefunds}: <Money value={-sales.refundAmount} /> <span className="num">({sales.refunds})</span></>}
      >
        <Money value={sales.net} />
      </Tile>
      <Tile
        label={t.overviewSalesCount}
        icon="numbers"
        meta={sales.count > 0 ? <span className="num">{t.overviewAverageMeta.replace('{amount}', formatShekel(Math.round(sales.amount / sales.count)))}</span> : null}
      >
        <span className="num">{sales.count}</span>
      </Tile>
    </section>
  );
}

/** «اختصارات» as square action tiles in the middle row (was a row of pills). */
export function ShortcutsCard({ items }: { items: { href: string; label: string; icon: IconName }[] }) {
  const { t } = usePrefs();
  return (
    <Card title={t.shortcuts} className="shortcuts-card">
      <div className="shortcut-grid" onPointerMove={followPointer}>
        {items.map((item) => (
          <Link key={item.href} className="shortcut-tile" href={item.href}>
            <span className="shortcut-tile-icon" aria-hidden="true"><Icon name={item.icon} /></span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function LinesCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const { lines } = data;
  const total = lines.active + lines.expiring + lines.frozen + lines.disconnected + lines.suspended;
  return (
    <Card title={t.overviewLines} hint={t.overviewLinesHint}>
      <Donut
        label={t.overviewLines}
        total={String(total)}
        slices={[
          { key: 'active', label: t.lineActive, value: lines.active, tone: '--rd-success', href: '/numbers?status=active' },
          { key: 'expiring', label: t.expiringSoon, value: lines.expiring, tone: '--rd-warning', href: '/numbers?status=expiring' },
          { key: 'frozen', label: t.lineFrozen, value: lines.frozen, tone: '--rd-chart-frozen', href: '/numbers?status=frozen' },
          { key: 'suspended', label: t.lineSuspended, value: lines.suspended, tone: '--rd-chart-suspended', href: '/numbers?status=suspended' },
          { key: 'disconnected', label: t.lineDisconnected, value: lines.disconnected, tone: '--rd-danger', href: '/numbers?status=disconnected' },
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
    { key: 'working', label: t.working, value: tasks.pending + tasks.working, tone: 'warning', href: '/tasks?status=working' },
    { key: 'closed', label: t.taskClosed, value: tasks.rejected + tasks.cancelled, tone: 'muted', href: '/tasks?status=cancelled' },
    { key: 'done', label: t.done, value: tasks.done, tone: 'success', href: '/tasks?status=done' },
  ];
  const all = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  const age = tasks.oldestOpenMinutes;
  const ageText = age === null ? t.noOpenTasks : t.oldestOpenTask.replace('{time}', age < 60 ? `${age}m` : age < 1440 ? `${Math.floor(age / 60)}h` : `${Math.floor(age / 1440)}d`);
  return (
    <Card title={t.overviewTasks} hint={ageText}>
      <ul className="overview-meters">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href}>
              <Badge variant={row.tone === 'info' ? 'muted' : row.tone} dot>{row.label}</Badge>
              <span className="overview-meter" aria-hidden="true"><span className={`fill ${row.tone}`} style={{ inlineSize: `${(row.value / all) * 100}%` }} /></span>
              <span className="num">{row.value}</span>
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
    <Card title={t.overviewProviders} hint={t.overviewProvidersHint} wide>
      {data.providers.length === 0 ? <EmptyState>{t.overviewEmpty}</EmptyState> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t.provider}</th>
                <th>{t.status}</th>
                <th className="num">{t.lineOps}</th>
                <th className="num">{t.providerConsumption}</th>
                <th className="num">{t.balance}</th>
                <th className="num">{t.providerAvailable}</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((row) => (
                <tr key={row.code}>
                  <td><Link href={`/provider-accounts/${encodeURIComponent(row.code)}`}>{row.name}</Link></td>
                  <td>
                    <Badge variant={row.status === 'working' ? 'success' : 'danger'} dot title={row.problem === 'balance' ? t.providerProblemBalance : row.problem === 'failures' ? t.providerProblemFailures.replace('{n}', String(row.failures)) : undefined}>
                      {row.status === 'working' ? t.providerWorking : t.providerProblem}
                    </Badge>
                  </td>
                  <td className="num">{row.operations}</td>
                  <td className="num"><Money value={row.cost} /></td>
                  <td className="num"><Money value={row.balance} /></td>
                  <td className="num"><Money value={row.available} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RankedList({ rows, by }: { rows: OverviewRanked[]; by: 'count' | 'profit' }) {
  const { t } = usePrefs();
  if (rows.length === 0) return <EmptyState>{t.overviewEmpty}</EmptyState>;
  const high = Math.max(1, ...rows.map((row) => Math.abs(row[by])));
  return (
    <ol className="overview-rank">
      {rows.map((row, index) => (
        <li key={row.key || index}>
          <span className="overview-rank-n num">{index + 1}</span>
          <span className="overview-rank-label">{row.nickname !== undefined ? <AccountName login={row.label} name={row.nickname} /> : row.label}</span>
          <span className="overview-meter" aria-hidden="true"><span className="fill success" style={{ inlineSize: `${(Math.abs(row[by]) / high) * 100}%` }} /></span>
          <span className="overview-rank-value">
            {by === 'count' ? <span className="num">{t.salesCountShort.replace('{n}', String(row.count))}</span> : <Money value={row.profit} signed />}
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
    <Card title={t.overviewTop} action={<Tabs items={tabs} value={tab} onChange={setTab} />}>
      {tab === 'packages' && <RankedList rows={data.top.packages} by="count" />}
      {tab === 'companies' && <RankedList rows={data.top.companies} by="profit" />}
      {tab === 'providers' && <RankedList rows={data.top.providers} by="profit" />}
    </Card>
  );
}

export function UsersCard({ data, layer }: { data: OverviewPayload; layer: string }) {
  const { t } = usePrefs();
  const { users } = data;
  return (
    <Card title={t.overviewUsers}>
      <Facts variant="list">
        {layer === 'branch' ? <Fact label={t.activeMainAgents}><Link className="num" href="/users?layer=main_agent">{users.counts.main_agent}</Link></Fact> : null}
        {layer === 'branch' || layer === 'main_agent' ? <Fact label={t.activeAgents}><Link className="num" href="/users?layer=agent">{users.counts.agent}</Link></Fact> : null}
        <Fact label={t.activePos}><Link className="num" href="/users?layer=pos">{users.counts.pos}</Link></Fact>
        <Fact label={t.usersFrozen}><span className="num">{users.frozen}</span></Fact>
        <Fact label={t.usersDebtors} tone={users.debtors ? 'warn' : undefined}><span className="num">{users.debtors}</span></Fact>
        <Fact label={t.usersDebt} tone={users.debt ? 'warn' : undefined}><Money value={users.debt} /></Fact>
        <Fact label={t.usersCeilings}><Money value={users.ceilings} /></Fact>
        <Fact label={t.usedCeiling}><Money value={users.used} /></Fact>
      </Facts>
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
    <Card title={t.overviewActive} action={tabs.length > 1 ? <Tabs items={tabs} value={tab} onChange={setTab} /> : undefined}>
      <RankedList rows={rows} by="count" />
    </Card>
  );
}
