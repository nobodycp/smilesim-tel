'use client';

import { Network, Store, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money } from '../../components/desk';
import { Donut } from '../../components/donut';
import { EmptyState } from '../../components/empty-state';
import { Tabs } from '../../components/tabs';
import { Badge } from '../../components/ui/badge';
import type { OverviewPayload, OverviewRanked } from '../../lib/api';
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
    { key: 'working', label: t.working, value: tasks.pending + tasks.working, tone: 'warning', href: '/tasks?status=working' },
    { key: 'closed', label: t.taskClosed, value: tasks.rejected + tasks.cancelled, tone: 'muted', href: '/tasks?status=cancelled' },
    { key: 'done', label: t.done, value: tasks.done, tone: 'success', href: '/tasks?status=done' },
  ];
  const all = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  const age = tasks.oldestOpenMinutes;
  const ageText = age === null ? t.noOpenTasks : t.oldestOpenTask.replace('{time}', (age < 60 ? t.minutesAgo.replace('{n}', String(age)) : age < 1440 ? t.hoursAgo.replace('{n}', String(Math.floor(age / 60))) : t.daysAgo.replace('{n}', String(Math.floor(age / 1440)))));
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
  // One tile per layer this viewer manages, then the credit picture (spec 2026-11-09-admin-review, 8.3).
  const layers = [
    ...(layer === 'branch' ? [{ key: 'main_agent', label: t.activeMainAgents, value: users.counts.main_agent, tone: '--rd-layer-main', icon: <Network size={16} /> }] : []),
    ...(layer === 'branch' || layer === 'main_agent' ? [{ key: 'agent', label: t.activeAgents, value: users.counts.agent, tone: '--rd-layer-agent', icon: <UsersRound size={16} /> }] : []),
    { key: 'pos', label: t.activePos, value: users.counts.pos, tone: '--rd-layer-pos', icon: <Store size={16} /> },
  ];
  const usedShare = users.ceilings > 0 ? Math.min(100, Math.round((users.used / users.ceilings) * 100)) : 0;
  return (
    <Card title={t.overviewUsers} className="users-card">
      <div className="users-layers">
        {layers.map((item) => (
          <Link key={item.key} className="users-layer" href={`/users?layer=${item.key}`} style={{ ['--tone' as string]: `var(${item.tone})` }}>
            <span className="users-layer-mark" aria-hidden="true">{item.icon}</span>
            <span className="users-layer-count num">{item.value}</span>
            <span className="users-layer-label">{item.label}</span>
          </Link>
        ))}
      </div>
      <div className="users-credit">
        <div className="users-credit-head">
          <span>{t.usedCeiling}</span>
          <span className="users-credit-figures"><Money value={users.used} /></span>
        </div>
        <div className="users-meter" role="img" aria-label={`${t.usedCeiling}: ${usedShare}%`}><i style={{ inlineSize: `${usedShare}%` }} /></div>
        <p className="users-credit-caption"><span>{t.usersCeilings} <Money value={users.ceilings} /></span><span className="num">{usedShare}%</span></p>
      </div>
      <ul className="users-flags">
        <li className={users.debtors ? 'warn' : undefined}>
          <span className="users-flag-label">{t.usersDebtors} <span className="users-flag-count num">{users.debtors}</span></span>
          <span className="users-flag-value" title={t.usersDebt}><Money value={users.debt} /></span>
        </li>
        <li>
          <span className="users-flag-label">{t.usersFrozen}</span>
          <span className="users-flag-value num">{users.frozen}</span>
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
    <Card title={t.overviewActive} action={tabs.length > 1 ? <Tabs items={tabs} value={tab} onChange={setTab} /> : undefined}>
      <RankedList rows={rows} by="count" />
    </Card>
  );
}
