'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { api, type ProfitRow } from '../../../lib/api';
import { formatShekel } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { useDesk } from '../../../lib/desk-session';
import { Badge } from '../../../components/ui/badge';
import { useApiQuery } from '../../../lib/use-api-query';
import { cellSubClass } from '../ledger-parts';
import { CsvLink, Period, ReportFilters, periodFrom, type PeriodDays } from '../../reports/report-kit';

const perSale = (row: ProfitRow) => (row.sales ? Math.round(row.profit / row.sales) : 0);

/**
 * What the signed-in account earned, by package, over a period (roadmap N4): every layer sees its own margin; refunds
 * take back their share. In the Graphite report layout: the period (30 days to start), a search, three figures — the
 * profit, the sales with their refunds, the best package —, the table by package, and the CSV in the head.
 */
export function ProfitsScreen() {
  const { t } = usePrefs();
  // The branch's profit is net of the operations marked as its loss (spec DB.5 P.8): a column and the stat's meta.
  const { me } = useDesk();
  const branch = me?.layer === 'branch';
  const [days, setDays] = useState<PeriodDays>(30);
  const [q, setQ] = useState('');
  const query = { from: periodFrom(days), to: '', q: q.trim() };
  const report = useApiQuery(['api', 'profits', query.from, query.q], () => api.profitReport(query));
  const data = report.data;
  const rows = data?.packages ?? [];
  const best = rows.reduce<ProfitRow | null>((top, row) => (!top || row.profit > top.profit ? row : top), null);

  const columns: Column<ProfitRow>[] = [
    { key: 'package', header: t.packageName, render: (row) => <><strong><bdi>{row.packageName || '—'}</bdi></strong>{row.companyName ? <span className={cellSubClass}>{row.companyName}</span> : null}</> },
    { key: 'sales', header: t.salesTitle, num: true, sortValue: (row) => row.sales, render: (row) => row.sales },
    { key: 'refunds', header: t.refundsTitle, num: true, sortValue: (row) => row.refunds, render: (row) => row.refunds },
    { key: 'margin', header: t.marginPerOp, num: true, sortValue: perSale, render: (row) => <Money value={perSale(row)} signed /> },
    ...(branch ? [{ key: 'losses', header: t.lossesTitle, num: true, sortValue: (row: ProfitRow) => row.losses, render: (row: ProfitRow) => (row.losses ? <Badge variant="danger" dot>{row.losses}</Badge> : row.losses) }] : []),
    { key: 'profit', header: t.yourProfit, num: true, sortValue: (row) => row.profit, render: (row) => <Money value={row.profit} signed /> },
  ];
  const periodMeta = t.lastDaysMeta.replace('{n}', String(days));
  const lossesMeta = data && branch
    ? <>{periodMeta} · {data.totals.losses
      ? <span className="font-bold text-danger" data-testid="profit-losses">{t.homeLossesMeta.replace('{n}', String(data.totals.losses)).replace('{amount}', formatShekel(data.totals.lossAmount))}</span>
      : t.homeNoLosses}</>
    : periodMeta;

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
        <Stat label={t.yourProfit} value={data ? <Money value={data.totals.profit} signed /> : '—'} meta={lossesMeta} highlight />
        <Stat label={t.salesTitle} value={data ? data.totals.sales : '—'} meta={t.refundsMeta.replace('{n}', String(data?.totals.refunds ?? 0))} />
        <Stat label={t.topPackage} value={best ? <bdi className="inline-block max-w-full text-2xl leading-1-35">{[best.companyName, best.packageName].filter(Boolean).join(' ')}</bdi> : '—'} meta={best ? t.perOperationMeta.replace('{amount}', `${formatShekel(perSale(best))} ₪`) : '—'} />
      </StatRow>
      <Pane>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.companyName}\n${row.packageName}`}
          loading={!report.loaded}
          failed={report.error}
          onRetry={() => void report.reload()}
          empty={t.noProfits}
          keepHead
          skeleton={{ rows: 5, columns: branch ? 6 : 5 }}
        />
      </Pane>
    </Desk>
  );
}
