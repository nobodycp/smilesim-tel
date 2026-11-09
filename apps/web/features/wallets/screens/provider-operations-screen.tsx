'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Stat, StatRow } from '../../../components/stat';
import { Period, ReportFilters, periodFrom, type PeriodDays } from '../../reports/report-kit';
import { reasonTone } from './finance-screen';
import { api, type ProviderOpRow, type ProviderOpStats } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { usePaged } from '../../../lib/use-paged';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';

const KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'] as const;

const EMPTY_STATS: ProviderOpStats = { count: 0, cost: 0, monthCost: 0 };

export function ProviderOperationsScreen() {
  const { t } = usePrefs();
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState<PeriodDays>(30);
  const from = periodFrom(days);
  const to = '';
  const [match, setMatch] = useState('');
  const list = usePaged<ProviderOpRow, { stats: ProviderOpStats; providers: { code: string; name: string }[] }>(
    `${provider}|${kind}|${q}|${from}|${to}|${match}`,
    async (cursor) => pick(await api.officeProviderOperations({ provider, kind, q, from, to, match, cursor }), (data) => ({
      rows: data.entries,
      next: data.nextCursor,
      total: data.total,
      extra: { stats: data.stats ?? EMPTY_STATS, providers: data.providers ?? [] },
    })),
  );
  const stats = list.extra?.stats ?? EMPTY_STATS;
  const providers = list.extra?.providers ?? [];

  const columns: Column<ProviderOpRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'kind',
      header: t.operationColumn,
      render: (row) => (
        <span className="kind-cell">
          <span className={`reason ${reasonTone(row.kind)}`}>{actionName(t, row.kind)}</span>
          {/* Same tag as the finance page: the eSIM fee folded into this operation's cost. */}
          {row.esimPrice != null && row.kind !== 'esim' && (
            <Badge variant="muted" dot title={t.esimSaleTagTitle}>
              {t.esimSaleTag}
              <Money value={row.esimPrice} />
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'provider', header: t.provider, render: (row) => <strong>{row.providerName || '—'}</strong> },
    { key: 'package', header: t.packageName, render: (row) => <><bdi>{row.packageName || '—'}</bdi>{row.companyName ? <span className="sub">{row.companyName}</span> : null}</> },
    { key: 'cost', header: t.providerCost, num: true, render: (row) => <Money value={row.cost ?? 0} /> },
    // Matching, simulated until real providers are connected (spec E): the source, what the provider charged, the gap.
    { key: 'source', header: t.matchSource, render: (row) => (row.matchSource === 'api' ? t.matchSourceApi : t.matchSourceStatement) },
    { key: 'charged', header: t.providerCharged, num: true, render: (row) => (row.providerAmount == null ? '—' : <Money value={row.providerAmount} />) },
    {
      key: 'match',
      header: t.matchState,
      render: (row) => row.matchState === 'pending'
        ? <Badge variant="muted" dot>{t.matchPending}</Badge>
        : row.matchState === 'difference'
          ? <Badge variant="danger" dot>{t.matchDifference} <Money value={row.difference ?? 0} signed /></Badge>
          : <Badge variant="success" dot>{t.matchMatched}</Badge>,
    },
  ];

  return (
    <Desk title={t.navProviderOps} lede={t.providerOpsLede} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={() => { setProvider(''); setKind(''); setQ(''); setMatch(''); }} clearLabel={t.clearFilters}>
          <label className="filter-search">
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">{t.number}</span>
            <input value={q} placeholder={t.number} onChange={(event) => setQ(event.target.value)} />
          </label>
          <label>
            {t.provider}
            <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">{t.allRows}</option>
              {providers.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </Select>
          </label>
          <label>
            {t.operationColumn}
            <Select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t.allRows}</option>
              {KINDS.map((value) => (
                <option key={value} value={value}>{actionName(t, value)}</option>
              ))}
            </Select>
          </label>
          <label>
            {t.matchState}
            <Select value={match} onChange={(event) => setMatch(event.target.value)}>
              <option value="">{t.allRows}</option>
              <option value="matched">{t.matchMatched}</option>
              <option value="difference">{t.matchDifference}</option>
              <option value="pending">{t.matchPending}</option>
            </Select>
          </label>
        </FilterBar>
      </ReportFilters>
      <StatRow>
        <Stat label={t.opsCount} value={stats.count} meta={t.lastDaysMeta.replace('{n}', String(days))} />
        <Stat label={t.providerCost} value={<Money value={stats.cost} />} meta={<>{t.providerMonth}: <Money value={stats.monthCost} /></>} />
        <Stat tone="success" label={t.matchMatched} value={<span className="tone-success">{stats.matched ?? 0}</span>} meta={t.pendingMeta.replace('{n}', String(stats.pending ?? 0))} />
        <Stat tone="danger" label={t.matchDifference} value={<span className={stats.differences ? 'tone-danger' : undefined}>{stats.differences ?? 0}</span>} meta={<Money value={stats.differenceAmount ?? 0} signed />} />
      </StatRow>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noProviderOps} keepHead skeleton={{ rows: 6, columns: 9 }} />
      </section>
    </Desk>
  );
}
