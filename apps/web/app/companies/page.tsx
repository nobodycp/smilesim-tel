'use client';

import Link from 'next/link';
import { DataTable, type Column } from '../../components/data-table';
import { Desk } from '../../components/desk';
import { api, type Shelf } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useLoad } from '../../lib/use-load';
import { useRequireLayer } from '../../lib/use-require-layer';

const BRANCH = ['branch'];
type Company = Shelf['companies'][number];

export default function CompaniesPage() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(BRANCH);
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });
  const columns: Column<Company>[] = [
    {
      key: 'company',
      header: t.company,
      render: (company) => <Link className="row-link" href={`/companies/${company.code}`}>{company.name}</Link>,
    },
    { key: 'providers', header: t.providersTitle, num: true, render: (company) => company.providers.length },
  ];

  return (
    <Desk title={allowed ? t.companiesTitle : ''} lede="" error={shelf.error} note="">
      <section className="pane">
        <DataTable
          columns={columns}
          rows={shelf.data?.companies ?? []}
          rowKey={(company) => company.code}
          loading={!shelf.loaded}
          skeleton={{ rows: 11, columns: 2 }}
          empty={t.noCompanies}
        />
      </section>
    </Desk>
  );
}
