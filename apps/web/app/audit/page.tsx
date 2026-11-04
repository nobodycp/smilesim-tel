'use client';

import { useState } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, actionName, latinWhen, taskStatus } from '../../components/desk';
import { FilterBar } from '../../components/filter-bar';
import { api, type AuditRow } from '../../lib/api';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';

export default function AuditPage() {
  const { t } = usePrefs();
  const { me } = useOffice();
  const branch = me?.layer === 'branch';
  const [kind, setKind] = useState('');
  const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', ...(branch ? ['enter'] : [])];
  const list = usePaged<AuditRow>(kind, async (cursor) =>
    pick(await api.officeAudit({ kind, cursor }), (data) => ({ rows: data.entries, next: data.nextCursor })),
  );

  const columns: Column<AuditRow>[] = [
    { key: 'kind', header: t.kind, render: (row) => actionName(t, row.action) },
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'number', header: t.number, cell: 'fit', render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    ...(branch ? [{ key: 'provider', header: t.provider, render: (row: AuditRow) => row.providerName || '—' }] : []),
    { key: 'actor', header: t.actedBy, render: (row) => row.actorName || '—' },
    { key: 'status', header: t.status, render: (row) => taskStatus(t, row.status) },
  ];

  return (
    <Desk title={t.navAudit} lede="" error={list.error} note="">
      <FilterBar onClear={() => setKind('')} clearLabel={t.clearFilters}>
        <label>
          {t.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t.allRows}</option>
            {kinds.map((value) => (
              <option key={value} value={value}>{actionName(t, value)}</option>
            ))}
          </select>
        </label>
      </FilterBar>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noMovements} keepHead skeleton={{ rows: 6, columns: 7 }} />
      </section>
    </Desk>
  );
}
