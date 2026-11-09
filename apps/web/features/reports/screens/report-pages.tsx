'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { queryString } from '../../../lib/http';
import { api, type BalanceReportRow, type SupplyReportRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { accountTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { CsvLink, Period, ReportFilters, periodFrom, type PeriodDays } from '../report-kit';

/**
 * The reports (spec 2026-11-08-reports; one page each since spec 2026-11-08-overview-and-reports-nav, C), in the
 * Graphite report layout. Balances and providers live here; «المبيعات» and «الطلبات» left by spec
 * 2026-11-09-admin-review, 1 (their rows are in «المالية» and «المهام»).
 */
const exportHref = (kind: string, query: Record<string, string>) => `/api/office/reports/${kind}/export${queryString(query)}`;

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

