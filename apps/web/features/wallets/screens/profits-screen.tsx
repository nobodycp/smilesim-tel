'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { api, type ProfitRow } from '../../../lib/api';
import { formatShekel } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { useApiQuery } from '../../../lib/use-api-query';
import { CsvLink, Period, ReportFilters, periodFrom, type PeriodDays } from '../../reports/report-kit';

const perSale = (row: ProfitRow) => (row.sales ? Math.round(row.profit / row.sales) : 0);

/**
 * What the signed-in account earned, by package, over a period (roadmap N4): every layer sees its own margin; refunds
 * take back their share. In the Graphite report layout: the period (30 days to start), a search, three figures — the
 * profit, the sales with their refunds, the best package —, the table by package, and the CSV in the head.
 */
export function ProfitsScreen() {
  const { t } = usePrefs();
  const [days, setDays] = useState<PeriodDays>(30);
  const [q, setQ] = useState('');
  const query = { from: periodFrom(days), to: '', q: q.trim() };
  const report = useApiQuery(['office', 'profits', query.from, query.q], () => api.profitReport(query));
  const data = report.data;
  const rows = data?.packages ?? [];
  const best = rows.reduce<ProfitRow | null>((top, row) => (!top || row.profit > top.profit ? row : top), null);

  const columns: Column<ProfitRow>[] = [
    { key: 'package', header: t.packageName, render: (row) => <><strong><bdi>{row.packageName || '—'}</bdi></strong>{row.companyName ? <span className="sub">{row.companyName}</span> : null}</> },
    { key: 'sales', header: t.salesTitle, num: true, sortValue: (row) => row.sales, render: (row) => row.sales },
    { key: 'refunds', header: t.refundsTitle, num: true, sortValue: (row) => row.refunds, render: (row) => row.refunds },
    { key: 'margin', header: t.marginPerOp, num: true, sortValue: perSale, render: (row) => <Money value={perSale(row)} signed /> },
    { key: 'profit', header: t.yourProfit, num: true, sortValue: (row) => row.profit, render: (row) => <Money value={row.profit} signed /> },
  ];

  return (
    <Desk title={t.navProfits} lede={t.profitsLede} action={<CsvLink href={api.profitExportHref(query)} />} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={() => setQ('')} clearLabel={t.clearFilters}>
          <label className="filter-search">
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">{t.financeSearch}</span>
            <input value={q} placeholder={t.financeSearch} onChange={(event) => setQ(event.target.value)} />
          </label>
        </FilterBar>
      </ReportFilters>
      <StatRow>
        <Stat label={t.yourProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} meta={t.lastDaysMeta.replace('{n}', String(days))} highlight />
        <Stat label={t.salesTitle} value={data ? data.totals.sales : '—'} meta={t.refundsMeta.replace('{n}', String(data?.totals.refunds ?? 0))} />
        <Stat label={t.topPackage} value={best ? <bdi className="stat-name">{[best.companyName, best.packageName].filter(Boolean).join(' ')}</bdi> : '—'} meta={best ? t.perOperationMeta.replace('{amount}', `${formatShekel(perSale(best))} ₪`) : '—'} />
      </StatRow>
      <section className="pane">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.companyName}\n${row.packageName}`}
          loading={!report.loaded}
          failed={report.error}
          onRetry={() => void report.reload()}
          empty={t.noProfits}
          keepHead
          skeleton={{ rows: 5, columns: 5 }}
        />
      </section>
    </Desk>
  );
}
