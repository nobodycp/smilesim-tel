'use client';

import { PagedTable, type Column } from '../../../components/data-table';
import { lineStatus } from '../../../components/desk';
import { api, type LineRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/use-load';
import { usePaged } from '../../../lib/use-paged';

/** Left pane: the existing data layer, unmodified. The control in this comparison. */
export function CurrentPane() {
  const { t } = usePrefs();
  const list = usePaged<LineRow>('all', async (cursor) =>
    pick(await api.officeLines({ cursor }), (data) => ({ rows: data.lines, next: data.nextCursor })),
  );

  const columns: Column<LineRow>[] = [
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <bdi dir="ltr">{line.msisdn}</bdi> },
    { key: 'company', header: t.company, render: (line) => line.companyName || '—' },
    { key: 'package', header: t.packageName, render: (line) => line.packageName },
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        <span className={line.status === 'active' ? 'badge' : line.status === 'frozen' ? 'badge pending' : 'badge cancelled'}>
          {lineStatus(t, line.status)}
        </span>
      ),
    },
    { key: 'ends', header: t.endsOn, render: (line) => new Date(line.endsAt).toLocaleDateString() },
  ];

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>usePaged + PagedTable</h2>
      </header>
      {list.error && <p className="hint">{list.error}</p>}
      <PagedTable list={list} columns={columns} rowKey={(line) => line.id} empty={t.noLines} skeleton={{ rows: 5, columns: 5 }} />
    </section>
  );
}
