'use client';

import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { PeriodChips } from '../../../components/period-chips';
import { api, type LedgerRow } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { layerName } from '../../../components/names';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { usePaged } from '../../../lib/use-paged';
import { Select } from '../../../components/ui/select';

const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'refresh', 'transfer'];

export function OperationsScreen() {
  const { t } = usePrefs();
  const layer = useDoor().layer;
  const [kind, setKind] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<LedgerRow>(`${kind}|${direction}|${from}|${to}`, async (cursor) =>
    pick(await api.officeLedger('operations', { kind, direction, from, to, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  const columns: Column<LedgerRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    ...(layer === 'pos' ? [] : [
      { key: 'layer', header: t.layer, render: (row: LedgerRow) => layerName(t, row.layer) },
      { key: 'account', header: t.accountName, render: (row: LedgerRow) => <AccountName login={row.loginName} /> },
    ]),
    { key: 'kind', header: t.kind, render: (row) => actionName(t, row.kind) },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'note', header: t.note, render: (row) => row.packageName || row.note || '' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} /> },
    { key: 'margin', header: t.myMargin, num: true, render: (row) => (row.margin == null ? '—' : <Money value={row.margin} signed />) },
    { key: 'before', header: t.balanceBefore, num: true, render: (row) => <Money value={row.balanceBefore} /> },
    { key: 'after', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];

  return (
    <Desk title={t.navOperations} lede="" error="" note="">
      <FilterBar onClear={() => { setKind(''); setDirection(''); setFrom(''); setTo(''); }} clearLabel={t.clearFilters}>
        <PeriodChips from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
        <label>
          {t.kind}
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {kinds.map((item) => (
              <option key={item} value={item}>{actionName(t, item)}</option>
            ))}
          </Select>
        </label>
        <label>
          {t.direction}
          <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="in">{t.increase}</option>
            <option value="out">{t.decrease}</option>
          </Select>
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
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: layer === 'pos' ? 8 : 10 }} />
      </section>
    </Desk>
  );
}
