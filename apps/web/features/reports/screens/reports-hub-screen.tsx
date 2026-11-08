'use client';

import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Tabs } from '../../../components/tabs';
import { Badge } from '../../../components/ui/badge';
import { buttonClass } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { queryString } from '../../../lib/http';
import { api, type BalanceReportRow, type OrderReportRow, type SaleReportRow, type SupplyReportRow } from '../../../lib/api';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { accountTone } from '../../../lib/status-tone';
import { useUrlFilters } from '../../../lib/url-state';
import { useApiQuery } from '../../../lib/use-api-query';
import { ProfitsReport } from '../../wallets/screens/profits-screen';

type Tab = 'sales' | 'profits' | 'orders' | 'balances' | 'supply';
const TABS: readonly Tab[] = ['sales', 'profits', 'orders', 'balances', 'supply'];

/** The first day of the window a dated report opens on: 30 days back, as a date field value. */
const monthAgo = () => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

/**
 * «التقارير» (spec 2026-11-08-reports, roadmap N5): sales, profits, orders, balances and, for the branch with the
 * reports grant, providers. Each report covers the signed-in account's own chain and exports its filters as CSV.
 * The open tab lives in the address (`?tab=`).
 */
export function ReportsHubScreen() {
  const { t } = usePrefs();
  const { me } = useOffice();
  const [filters, setFilters] = useUrlFilters(['tab'] as const);
  const supply = me?.layer === 'branch' && (me.isBranchOwner || me.grants.includes('reports'));
  const tabs = TABS.filter((key) => key !== 'supply' || supply);
  const tab: Tab = tabs.find((key) => key === filters.tab) ?? 'sales';
  const names: Record<Tab, string> = { sales: t.salesTitle, profits: t.navProfits, orders: t.ordersTitle, balances: t.balancesTitle, supply: t.providersTitle };

  return (
    <Desk title={t.navReports} lede={t.reportsLede} error="" note="">
      <Tabs items={tabs.map((key) => ({ key, label: names[key] }))} value={tab} onChange={(next) => setFilters({ tab: next })} />
      {tab === 'sales' && <SalesReport />}
      {tab === 'profits' && <ProfitsReport />}
      {tab === 'orders' && <OrdersReport />}
      {tab === 'balances' && <BalancesReport />}
      {tab === 'supply' && <SupplyReport />}
    </Desk>
  );
}

function Export({ kind, query }: { kind: string; query: Record<string, string> }) {
  const { t } = usePrefs();
  return (
    <a className={buttonClass({ variant: 'outline', size: 'sm' })} href={`/api/office/reports/${kind}/export${queryString(query)}`} download>
      <Download size={15} aria-hidden="true" />
      {t.exportCsv}
    </a>
  );
}

function Dates({ from, to, setFrom, setTo, children }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; children?: ReactNode }) {
  const { t } = usePrefs();
  return (
    <FilterBar onClear={() => { setFrom(monthAgo()); setTo(''); }} clearLabel={t.clearFilters}>
      <label>
        {t.from}
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label>
        {t.to}
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </label>
      {children}
    </FilterBar>
  );
}

function SalesReport() {
  const { t } = usePrefs();
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const query = { from, to, q: q.trim() };
  const report = useApiQuery(['office', 'reports', 'sales', query], () => api.reportSales(query));
  const data = report.data;
  const columns: Column<SaleReportRow>[] = [
    { key: 'at', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'account', header: t.pointOfSale, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'kind', header: t.movement, render: (row) => actionName(t, row.kind) },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'amount', header: t.amount, num: true, sortValue: (row) => row.amount, render: (row) => <Money value={row.amount} /> },
    { key: 'margin', header: t.myMargin, num: true, sortValue: (row) => row.margin ?? 0, render: (row) => (row.margin == null ? '—' : <Money value={row.margin} signed />) },
  ];
  return (
    <>
      <StatRow>
        <Stat icon="reports" label={t.salesTitle} value={data ? data.totals.count : '—'} />
        <Stat icon="wallet" label={t.salesAmount} value={data ? <Money value={data.totals.amount} /> : '—'} />
        <Stat icon="plans" label={t.netProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} highlight />
      </StatRow>
      <div className="section-head"><h2>{t.salesTitle}</h2><Export kind="sales" query={query} /></div>
      <Dates from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <label>
          {t.financeSearch}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </Dates>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.id} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 8 }} />
      </section>
    </>
  );
}

function OrdersReport() {
  const { t } = usePrefs();
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const query = { from, to, q: q.trim(), status };
  const report = useApiQuery(['office', 'reports', 'orders', query], () => api.reportOrders(query));
  const data = report.data;
  const statusName = (value: string) => (value === 'done' ? t.orderDone : value === 'open' ? t.orderOpen : t.orderCancelled);
  const columns: Column<OrderReportRow>[] = [
    { key: 'at', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'account', header: t.pointOfSale, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'action', header: t.movement, render: (row) => actionName(t, row.action) },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'status', header: t.status, render: (row) => <Badge variant={row.status === 'done' ? 'success' : row.status === 'open' ? 'warning' : 'danger'} dot>{statusName(row.status)}</Badge> },
    { key: 'amount', header: t.amount, num: true, sortValue: (row) => row.amount, render: (row) => <Money value={row.amount} /> },
  ];
  return (
    <>
      <StatRow>
        <Stat icon="tasks" label={t.ordersTitle} value={data ? data.totals.count : '—'} />
        <Stat icon="tasks" tone="success" label={t.orderDone} value={data ? data.totals.done : '—'} />
        <Stat icon="tasks" tone="warning" label={t.orderOpen} value={data ? data.totals.open : '—'} />
        <Stat icon="tasks" tone="danger" label={t.orderCancelled} value={data ? data.totals.cancelled : '—'} />
      </StatRow>
      <div className="section-head"><h2>{t.ordersTitle}</h2><Export kind="orders" query={query} /></div>
      <Dates from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <label>
          {t.status}
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="done">{t.orderDone}</option>
            <option value="open">{t.orderOpen}</option>
            <option value="cancelled">{t.orderCancelled}</option>
          </Select>
        </label>
        <label>
          {t.financeSearch}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </Dates>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.id} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 7 }} />
      </section>
    </>
  );
}

function BalancesReport() {
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState('');
  const [negative, setNegative] = useState(false);
  const query = { q: q.trim(), layer, negative: negative ? '1' : '' };
  const report = useApiQuery(['office', 'reports', 'balances', query], () => api.reportBalances(query));
  const data = report.data;
  const columns: Column<BalanceReportRow>[] = [
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.loginName} name={row.nickname} /> },
    { key: 'layer', header: t.layer, render: (row) => layerName(t, row.layer) },
    { key: 'parent', header: t.parent, render: (row) => <AccountName login={row.parentLogin} /> },
    { key: 'balance', header: t.balance, num: true, sortValue: (row) => row.balance, render: (row) => <Money value={row.balance} /> },
    { key: 'ceiling', header: t.ceiling, num: true, sortValue: (row) => row.ceiling, render: (row) => <Money value={row.ceiling} /> },
    { key: 'used', header: t.usedCeiling, num: true, sortValue: (row) => row.used, render: (row) => <Money value={row.used} /> },
    { key: 'held', header: t.held, num: true, sortValue: (row) => row.held, render: (row) => <Money value={row.held ?? 0} /> },
    { key: 'available', header: t.availableToSell, num: true, sortValue: (row) => row.available, render: (row) => <Money value={row.available} /> },
    { key: 'status', header: t.status, render: (row) => <Badge variant={accountTone(row.frozen)} dot>{row.frozen ? t.frozen : t.accountOpen}</Badge> },
    { key: 'last', header: t.lastMovement, cell: 'when', render: (row) => (row.lastAt ? <bdi dir="ltr">{latinWhen(row.lastAt)}</bdi> : '—') },
  ];
  return (
    <>
      <StatRow>
        <Stat icon="staff" label={t.accountsCount} value={data ? data.totals.count : '—'} />
        <Stat icon="wallet" label={t.balancesTotal} value={data ? <Money value={data.totals.balance} /> : '—'} />
        <Stat icon="lock" tone="warning" label={t.usedCeiling} value={data ? <Money value={data.totals.used} /> : '—'} />
      </StatRow>
      <div className="section-head"><h2>{t.balancesTitle}</h2><Export kind="balances" query={query} /></div>
      <FilterBar onClear={() => { setQ(''); setLayer(''); setNegative(false); }} clearLabel={t.clearFilters}>
        <label>
          {t.accountName}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          {t.layer}
          <Select value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{t.allRows}</option>
            {['main_agent', 'agent', 'pos'].map((value) => <option key={value} value={value}>{layerName(t, value)}</option>)}
          </Select>
        </label>
        <label className="check">
          <input type="checkbox" checked={negative} onChange={(event) => setNegative(event.target.checked)} />
          <span>{t.negativeOnly}</span>
        </label>
      </FilterBar>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.loginName} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 9 }} />
      </section>
    </>
  );
}

function SupplyReport() {
  const { t } = usePrefs();
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState('');
  const query = { from, to };
  const report = useApiQuery(['office', 'reports', 'supply', query], () => api.reportSupply(query));
  const data = report.data;
  const columns: Column<SupplyReportRow>[] = [
    { key: 'provider', header: t.provider, render: (row) => row.providerName },
    { key: 'operations', header: t.ordersTitle, num: true, sortValue: (row) => row.operations, render: (row) => row.operations },
    { key: 'cost', header: t.providerCost, num: true, sortValue: (row) => row.cost, render: (row) => <Money value={row.cost} /> },
    { key: 'profit', header: t.netProfit, num: true, sortValue: (row) => row.profit, render: (row) => <Money value={row.profit} signed /> },
  ];
  return (
    <>
      <StatRow>
        <Stat icon="providers" label={t.ordersTitle} value={data ? data.totals.operations : '—'} />
        <Stat icon="wallet" label={t.providerCost} value={data ? <Money value={data.totals.cost} /> : '—'} />
        <Stat icon="plans" label={t.netProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} highlight />
      </StatRow>
      <div className="section-head"><h2>{t.providersTitle}</h2><Export kind="supply" query={query} /></div>
      <Dates from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.providerCode} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 4, columns: 4 }} />
      </section>
    </>
  );
}
