'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { queryString } from '../../../lib/http';
import { api, type BalanceReportRow, type OrderReportRow, type SaleReportRow, type SupplyReportRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { accountTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { CsvLink, Period, ReportFilters, periodFrom, type PeriodDays } from '../report-kit';

/** The movements a sale can be (API `SALE_KINDS`). */
const SALE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];
/** The line operations an order can be (API `PROVIDER_OPERATION_KINDS`). */
const ORDER_ACTIONS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'];

/** A task's short reference (the first six characters of its id), a link to its ticket. */
const taskRef = (id: string) => `#${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

const exportHref = (kind: string, query: Record<string, string>) => `/api/office/reports/${kind}/export${queryString(query)}`;

/**
 * The reports (spec 2026-11-08-reports, roadmap N5; one page each since spec 2026-11-08-overview-and-reports-nav, C),
 * in the Graphite report layout: the title, its lede and the CSV; the period and the filter chips; three figures with
 * a meta line; the table. Each covers the signed-in account's own chain and exports its filters as CSV. They sit in
 * the sidebar's «التقارير» group; `/reports` opens the first.
 */
export function SalesReportScreen() {
  const { t } = usePrefs();
  const [days, setDays] = useState<PeriodDays>(30);
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const query = { from: periodFrom(days), to: '', q: q.trim(), account, kind };
  const report = useApiQuery(['office', 'reports', 'sales', query], () => api.reportSales(query));
  const data = report.data;
  const count = data?.totals.count ?? 0;
  const columns: Column<SaleReportRow>[] = [
    { key: 'at', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'kind', header: t.movement, render: (row) => actionName(t, row.kind) },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr" className="msisdn">{row.msisdn}</bdi> : '—') },
    { key: 'package', header: t.packageName, render: (row) => <><bdi>{row.packageName || '—'}</bdi>{row.companyName ? <span className="sub">{row.companyName}</span> : null}</> },
    { key: 'amount', header: t.amount, num: true, sortValue: (row) => row.amount, render: (row) => <Money value={row.amount} /> },
    { key: 'margin', header: t.yourProfit, num: true, sortValue: (row) => row.margin ?? 0, render: (row) => (row.margin == null ? '—' : <Money value={row.margin} signed />) },
  ];
  return (
    <Desk title={t.salesTitle} lede={t.salesLede} action={<CsvLink href={exportHref('sales', query)} />} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={() => { setQ(''); setAccount(''); setKind(''); }} clearLabel={t.clearFilters}>
          <label className="filter-search">
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">{t.financeSearch}</span>
            <input value={q} placeholder={t.financeSearch} onChange={(event) => setQ(event.target.value)} />
          </label>
          <label>
            {t.accountName}
            <Select value={account} onChange={(event) => setAccount(event.target.value)}>
              <option value="">{t.allRows}</option>
              {(data?.accounts ?? []).map((row) => <option key={row.loginName} value={row.loginName}>{row.nickname ? `${row.nickname} (${row.loginName})` : row.loginName}</option>)}
            </Select>
          </label>
          <label>
            {t.movement}
            <Select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t.allRows}</option>
              {SALE_KINDS.map((value) => <option key={value} value={value}>{actionName(t, value)}</option>)}
            </Select>
          </label>
        </FilterBar>
      </ReportFilters>
      <StatRow>
        <Stat label={t.salesTotal} value={data ? <Money value={data.totals.amount} /> : '—'} meta={t.opsCountMeta.replace('{n}', String(count))} />
        <Stat label={t.yourProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} meta={t.afterRefunds} highlight />
        <Stat label={t.avgOperation} value={data ? <Money value={count ? Math.round(data.totals.amount / count) : 0} /> : '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} />
      </StatRow>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.id} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 7 }} />
      </section>
    </Desk>
  );
}

export function OrdersReportScreen() {
  const { t } = usePrefs();
  const [days, setDays] = useState<PeriodDays>(30);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  const query = { from: periodFrom(days), to: '', q: q.trim(), status, action };
  const report = useApiQuery(['office', 'reports', 'orders', query], () => api.reportOrders(query));
  const data = report.data;
  const statusName = (value: string) => (value === 'done' ? t.orderDone : value === 'open' ? t.orderOpen : t.orderCancelled);
  const share = data && data.totals.count ? Math.round((data.totals.done / data.totals.count) * 100) : 0;
  const columns: Column<OrderReportRow>[] = [
    { key: 'at', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'task',
      header: t.taskColumn,
      fit: true,
      render: (row) => (row.taskId ? <Link className="task-ref" href={`/tasks/${row.taskId}`}><bdi dir="ltr">{taskRef(row.taskId)}</bdi></Link> : '—'),
    },
    { key: 'action', header: t.operationColumn, render: (row) => actionName(t, row.action) },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr" className="msisdn">{row.msisdn}</bdi> : '—') },
    { key: 'account', header: t.pointOfSale, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'package', header: t.packageName, render: (row) => <><bdi>{row.packageName || '—'}</bdi>{row.companyName ? <span className="sub">{row.companyName}</span> : null}</> },
    { key: 'status', header: t.status, render: (row) => <Badge variant={row.status === 'done' ? 'success' : row.status === 'open' ? 'warning' : 'danger'} dot>{statusName(row.status)}</Badge> },
    { key: 'handler', header: t.handledBy, render: (row) => (row.handlerLogin ? <AccountName login={row.handlerLogin} /> : '—') },
    { key: 'amount', header: t.amount, num: true, sortValue: (row) => row.amount, render: (row) => <Money value={row.amount} /> },
  ];
  return (
    <Desk title={t.ordersTitle} lede={t.ordersLede} action={<CsvLink href={exportHref('orders', query)} />} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={() => { setQ(''); setStatus(''); setAction(''); }} clearLabel={t.clearFilters}>
          <label className="filter-search">
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">{t.financeSearch}</span>
            <input value={q} placeholder={t.financeSearch} onChange={(event) => setQ(event.target.value)} />
          </label>
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
            {t.operationColumn}
            <Select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">{t.allRows}</option>
              {ORDER_ACTIONS.map((value) => <option key={value} value={value}>{actionName(t, value)}</option>)}
            </Select>
          </label>
        </FilterBar>
      </ReportFilters>
      <StatRow>
        <Stat label={t.allOrders} value={data ? data.totals.count : '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} />
        <Stat tone="success" label={t.orderDone} value={data ? <span className="tone-success">{data.totals.done}</span> : '—'} meta={`${share}%`} />
        <Stat tone="danger" label={t.orderCancelled} value={data ? <span className="tone-danger">{data.totals.cancelled}</span> : '—'} meta={t.openMeta.replace('{n}', String(data?.totals.open ?? 0))} />
      </StatRow>
      <section className="pane">
        <DataTable columns={columns} rows={data?.rows ?? []} rowKey={(row) => row.id} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 7 }} />
      </section>
    </Desk>
  );
}

/** Main agent, agent and the branch: the wallets under the account, now (no period). */
export function BalancesReportScreen() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(['branch', 'main_agent', 'agent']);
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState('');
  const [negative, setNegative] = useState(false);
  const query = { q: q.trim(), layer, negative: negative ? '1' : '' };
  const report = useApiQuery(['office', 'reports', 'balances', query], () => api.reportBalances(query), { enabled: allowed });
  const data = report.data;
  const rows = data?.rows ?? [];
  const held = rows.reduce((sum, row) => sum + (row.held ?? 0), 0);
  const near = rows.filter((row) => row.ceiling > 0 && row.used / row.ceiling >= 0.85);
  const columns: Column<BalanceReportRow>[] = [
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.loginName} name={row.nickname} /> },
    { key: 'layer', header: t.layer, fit: true, render: (row) => <span className={`layer-tag l-${row.layer}`}>{layerName(t, row.layer)}</span> },
    { key: 'parent', header: t.parent, render: (row) => <AccountName login={row.parentLogin} /> },
    { key: 'balance', header: t.balance, num: true, sortValue: (row) => row.balance, render: (row) => <Money value={row.balance} /> },
    { key: 'ceiling', header: t.ceiling, num: true, sortValue: (row) => row.ceiling, render: (row) => <Money value={row.ceiling} /> },
    { key: 'held', header: t.held, num: true, sortValue: (row) => row.held, render: (row) => <Money value={row.held ?? 0} /> },
    { key: 'available', header: t.availableToSell, num: true, sortValue: (row) => row.available, render: (row) => <Money value={row.available} /> },
    { key: 'status', header: t.status, render: (row) => <Badge variant={accountTone(row.frozen)} dot>{row.frozen ? t.frozen : t.accountOpen}</Badge> },
  ];
  return (
    <Desk title={t.balancesTitle} lede={t.balancesLede} action={allowed ? <CsvLink href={exportHref('balances', query)} /> : undefined} error="" note="">
      {allowed ? (
        <>
          <ReportFilters>
            <FilterBar loose onClear={() => { setQ(''); setLayer(''); setNegative(false); }} clearLabel={t.clearFilters}>
              <label className="filter-search">
                <Search size={16} strokeWidth={1.9} aria-hidden="true" />
                <span className="sr-only">{t.accountName}</span>
                <input value={q} placeholder={t.accountName} onChange={(event) => setQ(event.target.value)} />
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
          </ReportFilters>
          <StatRow>
            <Stat label={t.balancesTotal} value={data ? <Money value={data.totals.balance} /> : '—'} meta={t.accountsMeta.replace('{n}', String(data?.totals.count ?? 0))} />
            <Stat label={t.heldForTasks} value={data ? <Money value={held} /> : '—'} meta={t.openTasksMeta} />
            <Stat tone="danger" label={t.nearCeiling} value={data ? <span className={near.length ? 'tone-danger' : undefined}>{near.length}</span> : '—'} meta={near.length ? near.slice(0, 2).map((row) => row.nickname || row.loginName).join('، ') : '—'} />
          </StatRow>
          <section className="pane">
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.loginName} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 5, columns: 8 }} />
          </section>
        </>
      ) : null}
    </Desk>
  );
}

/** Providers: the branch owner and staff with the reports grant (the API refuses the rest). */
export function SupplyReportScreen() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(['branch']);
  const [days, setDays] = useState<PeriodDays>(30);
  const query = { from: periodFrom(days), to: '' };
  const report = useApiQuery(['office', 'reports', 'supply', query], () => api.reportSupply(query), { enabled: allowed });
  const data = report.data;
  const rows = data?.rows ?? [];
  const total = data?.totals.cost ?? 0;
  const shareOf = (cost: number) => (total > 0 ? Math.round((cost / total) * 100) : 0);
  const top = rows.reduce<SupplyReportRow | null>((best, row) => (!best || row.cost > best.cost ? row : best), null);
  const columns: Column<SupplyReportRow>[] = [
    { key: 'provider', header: t.provider, render: (row) => <strong>{row.providerName}</strong> },
    { key: 'operations', header: t.operationsWord, num: true, sortValue: (row) => row.operations, render: (row) => row.operations },
    { key: 'cost', header: t.providerCost, num: true, sortValue: (row) => row.cost, render: (row) => <Money value={row.cost} /> },
    { key: 'profit', header: t.netProfit, num: true, sortValue: (row) => row.profit, render: (row) => <Money value={row.profit} signed /> },
    {
      key: 'share',
      header: t.shareColumn,
      sortValue: (row) => row.cost,
      render: (row) => (
        <span className="cap">
          <span className="cap-bar"><i style={{ inlineSize: `${shareOf(row.cost)}%` }} /></span>
          <bdi dir="ltr">{shareOf(row.cost)}%</bdi>
        </span>
      ),
    },
  ];
  return (
    <Desk title={t.reportProviders} lede={t.supplyLede} action={allowed ? <CsvLink href={exportHref('supply', query)} /> : undefined} error="" note="">
      {allowed ? (
        <>
          <ReportFilters>
            <Period days={days} onPick={setDays} />
          </ReportFilters>
          <StatRow>
            <Stat label={t.providerCost} value={data ? <Money value={total} /> : '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} />
            <Stat label={t.operationsWord} value={data ? data.totals.operations : '—'} meta={t.atProvidersMeta.replace('{n}', String(rows.length))} />
            <Stat label={t.topProvider} value={top ? <bdi className="stat-name">{top.providerName}</bdi> : '—'} meta={top ? t.shareOfCostMeta.replace('{n}', String(shareOf(top.cost))) : '—'} />
          </StatRow>
          <section className="pane">
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.providerCode} loading={!report.loaded} failed={report.error} onRetry={() => void report.reload()} empty={t.noRows} keepHead skeleton={{ rows: 4, columns: 5 }} />
          </section>
        </>
      ) : null}
    </Desk>
  );
}

