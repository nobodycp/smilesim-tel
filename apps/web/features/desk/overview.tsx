'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money } from '../../components/desk';
import { Donut } from '../../components/donut';
import { EmptyState } from '../../components/empty-state';
import { Fact, Facts } from '../../components/facts';
import { Tabs } from '../../components/tabs';
import { Badge } from '../../components/ui/badge';
import type { OverviewPayload, OverviewRanked } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

// The home page's overview cards (spec 2026-11-08-overview-and-reports-nav, F). Each card draws only what the
// overview answered for this viewer: a layer without providers or main agents simply gets no such card or tab.

/** A token-coloured geometric layer behind a card (ring, square and triangle); decoration only. */
export function Shapes() {
  return (
    <svg className="overview-shapes" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <circle cx="128" cy="26" r="20" className="shape-ring" />
      <rect x="92" y="70" width="26" height="26" rx="4" transform="rotate(18 105 83)" className="shape-square" />
      <path d="M140 72 L156 102 L124 102 Z" className="shape-triangle" />
      <circle cx="66" cy="18" r="4" className="shape-dot" />
    </svg>
  );
}

function Card({ title, hint, action, wide, decor, children, className = '' }: { title: string; hint?: string; action?: ReactNode; wide?: boolean; decor?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`pane overview-card${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}>
      <header className="pane-head">
        {decor ? <Shapes /> : null}
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

export function SalesCard({ data }: { data: OverviewPayload }) {
  const { t } = usePrefs();
  const { sales } = data;
  const high = Math.max(1, ...sales.trend.map((point) => point.amount));
  return (
    <Card title={t.overviewSales} wide decor className="overview-sales">
      <Facts variant="cards">
        <Fact label={t.overviewSalesAmount}><Money value={sales.amount} /></Fact>
        <Fact label={t.overviewSalesCount}><span className="num">{sales.count}</span></Fact>
        <Fact label={t.overviewMyProfit} tone="good"><Money value={sales.profit} signed /></Fact>
        <Fact label={t.overviewRefunds}><Money value={-sales.refundAmount} /> <span className="hint num">({sales.refunds})</span></Fact>
        <Fact label={t.overviewNet}><Money value={sales.net} /></Fact>
      </Facts>
      {sales.trend.length > 1 ? (
        // Time runs left to right in every language, like the balance chart.
        <div className="overview-trend" dir="ltr" role="img" aria-label={`${t.overviewTrend}: ${sales.trend.map((point) => `${point.day} ${(point.amount / 100).toFixed(2)}`).join(', ')}`}>
          {sales.trend.map((point) => (
            <span key={point.day} className="overview-bar" style={{ blockSize: `${Math.max(4, (point.amount / high) * 100)}%` }} title={`${point.day} · ${(point.amount / 100).toFixed(2)} ₪`} />
          ))}
        </div>
      ) : null}
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
    { key: 'pending', label: t.pending, value: tasks.pending, tone: 'warning', href: '/tasks?status=pending' },
    { key: 'working', label: t.working, value: tasks.working, tone: 'warning', href: '/tasks?status=working' },
    { key: 'done', label: t.done, value: tasks.done, tone: 'success', href: '/tasks?status=done' },
    { key: 'rejected', label: t.taskRejected, value: tasks.rejected, tone: 'danger', href: '/tasks?status=rejected' },
    { key: 'cancelled', label: t.cancelled, value: tasks.cancelled, tone: 'muted', href: '/tasks?status=cancelled' },
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
