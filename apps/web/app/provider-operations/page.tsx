'use client';

import { useState } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, Money, actionName, latinWhen } from '../../components/desk';
import { FilterBar } from '../../components/filter-bar';
import { Stat, StatRow } from '../../components/stat';
import { api, type ProviderOpRow, type ProviderOpStats } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';
import { Badge } from '../../components/ui/badge';

const KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'] as const;

const EMPTY_STATS: ProviderOpStats = { count: 0, cost: 0, monthCost: 0 };

export default function ProviderOperationsPage() {
  const { t } = usePrefs();
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<ProviderOpRow, { stats: ProviderOpStats; providers: { code: string; name: string }[] }>(
    `${provider}|${kind}|${q}|${from}|${to}`,
    async (cursor) => pick(await api.officeProviderOperations({ provider, kind, q, from, to, cursor }), (data) => ({
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
      header: t.kind,
      render: (row) => (
        <span className="kind-cell">
          {actionName(t, row.kind)}
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
    { key: 'provider', header: t.provider, render: (row) => row.providerName || '—' },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'cost', header: t.providerCost, num: true, render: (row) => <Money value={row.cost ?? 0} /> },
  ];

  return (
    <Desk title={t.navProviderOps} lede="" error="" note="">
      <FilterBar onClear={() => { setProvider(''); setKind(''); setQ(''); setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.provider}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{t.allRows}</option>
            {providers.map((item) => (
              <option key={item.code} value={item.code}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>{actionName(t, value)}</option>
            ))}
          </select>
        </label>
        <label>
          {t.number}
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          {t.from}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.to}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </FilterBar>
      <section className="pane">
        <div className="pane-body">
          <StatRow>
            <Stat icon="numbers" tone="muted" value={stats.count} label={t.opsCount} />
            <Stat icon="wallet" tone="warning" value={<Money value={stats.cost} />} label={t.providerCost} />
            <Stat icon="plans" tone="warning" value={<Money value={stats.monthCost} />} label={t.providerMonth} />
          </StatRow>
        </div>
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noProviderOps} keepHead skeleton={{ rows: 6, columns: 7 }} />
      </section>
    </Desk>
  );
}
