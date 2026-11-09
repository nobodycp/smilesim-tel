'use client';

import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, actionName, latinWhen } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { api, type LedgerRow } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { layerName } from '../../../components/names';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { usePaged } from '../../../lib/use-paged';
import { Select } from '../../../components/ui/select';
import { Period, ReportFilters, periodFrom, type PeriodDays } from '../../reports/report-kit';
import { reasonTone } from './finance-screen';

const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'refresh', 'transfer'];

export function OperationsScreen() {
  const { t } = usePrefs();
  const layer = useDoor().layer;
  const [kind, setKind] = useState('');
  const [direction, setDirection] = useState('');
  const [days, setDays] = useState<PeriodDays>(30);
  const from = periodFrom(days);
  const to = '';
  const list = usePaged<LedgerRow>(`${kind}|${direction}|${from}|${to}`, async (cursor) =>
    pick(await api.officeLedger('operations', { kind, direction, from, to, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor, total: data.total })),
  );

  const columns: Column<LedgerRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    ...(layer === 'pos' ? [] : [
      {
        key: 'account',
        header: t.accountName,
        render: (row: LedgerRow) => (
          <span className="who-cell">
            <AccountName login={row.loginName} />
            {row.layer ? <span className={`layer-tag l-${row.layer}`}>{layerName(t, row.layer)}</span> : null}
          </span>
        ),
      },
    ]),
    { key: 'kind', header: t.operationColumn, render: (row) => <span className={`reason ${reasonTone(row.kind)}`}>{actionName(t, row.kind)}</span> },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr" className="msisdn">{row.msisdn}</bdi> : '—') },
    { key: 'note', header: t.detailsColumn, render: (row) => row.packageName || row.note || '—' },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} signed /> },
    { key: 'margin', header: t.myMargin, num: true, render: (row) => (row.margin == null ? '—' : <Money value={row.margin} signed />) },
    { key: 'after', header: t.balanceAfterShort, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];

  return (
    <Desk title={t.navOperations} lede={t.operationsLede} error="" note="">
      <ReportFilters>
        <Period days={days} onPick={setDays} />
        <FilterBar loose onClear={() => { setKind(''); setDirection(''); }} clearLabel={t.clearFilters}>
          <label>
            {t.operationColumn}
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
        </FilterBar>
      </ReportFilters>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: layer === 'pos' ? 7 : 8 }} />
      </section>
    </Desk>
  );
}
