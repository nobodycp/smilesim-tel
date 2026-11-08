'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { buttonClass } from '../../../components/ui/button';
import { api, type ProfitRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useApiQuery } from '../../../lib/use-api-query';

/** The first day of the window the page opens on: 30 days back, as a date field value. */
function monthAgo(): string {
  return new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * What the signed-in account earned, by package, over a period (roadmap N4): every layer sees its own margin; refunds
 * take back their share. Opens on the last 30 days; the dates, a search and a CSV follow the filters.
 */
export function ProfitsScreen() {
  const { t } = usePrefs();
  return (
    <Desk title={t.navProfits} lede={t.profitsLede} error="" note="">
      <ProfitsReport />
    </Desk>
  );
}

/** The profit report itself: cards, filters, the table by package and its CSV. Also a tab of «التقارير». */
export function ProfitsReport() {
  const { t } = usePrefs();
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const query = { from, to, q: q.trim() };
  const report = useApiQuery(['office', 'profits', from, to, query.q], () => api.profitReport(query));
  const data = report.data;

  const columns: Column<ProfitRow>[] = [
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'sales', header: t.salesTitle, num: true, sortValue: (row) => row.sales, render: (row) => row.sales },
    { key: 'refunds', header: t.refundsTitle, num: true, sortValue: (row) => row.refunds, render: (row) => row.refunds },
    { key: 'profit', header: t.netProfit, num: true, sortValue: (row) => row.profit, render: (row) => <Money value={row.profit} signed /> },
  ];

  return (
    <>
      <StatRow>
        <Stat icon="reports" label={t.salesTitle} value={data ? data.totals.sales : '—'} />
        <Stat icon="numbers" label={t.refundsTitle} value={data ? data.totals.refunds : '—'} />
        <Stat icon="wallet" label={t.netProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} highlight />
      </StatRow>
      <div className="section-head">
        <h2>{t.profitByPackage}</h2>
        <a className={buttonClass({ variant: 'outline', size: 'sm' })} href={api.profitExportHref(query)} download>
          <Download size={15} aria-hidden="true" />
          {t.exportCsv}
        </a>
      </div>
      <FilterBar onClear={() => { setFrom(monthAgo()); setTo(''); setQ(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.from}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          {t.financeSearch}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </FilterBar>
      <section className="pane">
        <DataTable
          columns={columns}
          rows={data?.packages ?? []}
          rowKey={(row) => `${row.companyName}\n${row.packageName}`}
          loading={!report.loaded}
          failed={report.error}
          onRetry={() => void report.reload()}
          empty={t.noProfits}
          keepHead
          skeleton={{ rows: 5, columns: 5 }}
        />
      </section>
    </>
  );
}
