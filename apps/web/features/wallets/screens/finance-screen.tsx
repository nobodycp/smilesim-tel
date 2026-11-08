'use client';

import { useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen, layerName } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { api, type FinanceRow } from '../../../lib/api';
import type { Copy } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/use-load';
import { usePaged } from '../../../lib/use-paged';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';

const KINDS = [
  'fund', 'self_fund',
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim',
] as const;

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

function movementName(t: Copy, kind: string): string {
  if (kind === 'fund') return t.supplyBalance;
  if (kind === 'self_fund') return t.topUpBalance;
  return actionName(t, kind);
}

export function FinanceScreen() {
  const { t } = usePrefs();
  const [kind, setKind] = useState('');
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<FinanceRow>(`${kind}|${layer}|${q}|${from}|${to}`, async (cursor) =>
    pick(await api.officeFinance({ kind, layer, q, from, to, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  const columns: Column<FinanceRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'layer', header: t.layer, render: (row) => (row.layer ? layerName(t, row.layer) : '—') },
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.loginName} /> },
    { key: 'actor', header: t.actedBy, render: (row) => <AccountName login={row.actorLogin} /> },
    {
      key: 'kind',
      header: t.kind,
      render: (row) => (
        <span className="kind-cell">
          {movementName(t, row.kind)}
          {/* An eSIM sale pays the package price plus this fee in one entry; the tag explains the amount. */}
          {row.esimPrice != null && row.kind !== 'esim' && (
            <Badge variant="muted" dot title={t.esimSaleTagTitle}>
              {t.esimSaleTag}
              <Money value={row.esimPrice} />
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} /> },
    { key: 'before', header: t.balanceBefore, num: true, render: (row) => <Money value={row.balanceBefore} /> },
    { key: 'after', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'price', header: t.packagePrice, num: true, render: (row) => (row.packagePrice == null ? '—' : <Money value={row.packagePrice} />) },
    { key: 'note', header: t.note, render: (row) => row.note || '—' },
  ];

  return (
    <Desk title={t.navFinance} lede="" error="" note="">
      <FilterBar onClear={() => { setKind(''); setLayer(''); setQ(''); setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
        <label>
          {t.kind}
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>{movementName(t, value)}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.layer}
          <Select value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{t.allRows}</option>
            {LAYERS.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.financeSearch}
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
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 13 }} />
      </section>
    </Desk>
  );
}
