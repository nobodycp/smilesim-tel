'use client';

import { useEffect, useState } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, Money, latinWhen } from '../../components/desk';
import { TableSearch } from '../../components/table-search';
import { api, type AccountingRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';

export default function AccountingPage() {
  const { t } = usePrefs();
  const [query, setQuery] = useState('');
  const [needle, setNeedle] = useState('');
  const list = usePaged<AccountingRow>(needle, async (cursor) =>
    pick(await api.officeAccounting({ q: needle, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor })),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const columns: Column<AccountingRow>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'number', header: t.number, cell: 'fit', render: (row) => <bdi dir="ltr">{row.msisdn}</bdi> },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'price', header: t.packagePrice, num: true, render: (row) => <Money value={row.packagePrice} /> },
    { key: 'before', header: t.balanceBefore, num: true, render: (row) => <Money value={row.balanceBefore} /> },
    { key: 'after', header: t.balanceAfter, num: true, render: (row) => <Money value={row.balanceAfter} /> },
  ];

  return (
    <Desk title={t.navAccounting} lede="" error={list.error} note="">
      <section className="pane">
        <TableSearch label={t.numberSearch} value={query} onChange={setQuery} />
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 7 }} />
      </section>
    </Desk>
  );
}
