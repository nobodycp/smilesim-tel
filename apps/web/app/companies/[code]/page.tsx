'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk } from '../../../components/desk';
import { api, type Shelf } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useLoad } from '../../../lib/use-load';
import { useRequireLayer } from '../../../lib/use-require-layer';

const BRANCH = ['branch'];
type Provider = Shelf['companies'][number]['providers'][number];

export default function CompanyProvidersPage() {
  const { t } = usePrefs();
  const params = useParams<{ code: string }>();
  const allowed = useRequireLayer(BRANCH);
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });
  const company = shelf.data?.companies.find((item) => item.code === params.code) ?? null;
  const columns: Column<Provider>[] = [
    {
      key: 'provider',
      header: t.provider,
      render: (provider) => (
        <Link className="row-link" href={`/companies/${params.code}/${provider.code}`}>{provider.name}</Link>
      ),
    },
    { key: 'packages', header: t.navPlans, num: true, render: (provider) => provider.packages.length },
  ];

  return (
    <Desk title={company?.name ?? ''} lede="" error={shelf.error} note="">
      <Link className="back-link" href="/companies">{t.companiesTitle}</Link>
      <section className="pane">
        <DataTable
          columns={columns}
          rows={company?.providers ?? []}
          rowKey={(provider) => provider.code}
          loading={!shelf.loaded}
          skeleton={{ rows: 5, columns: 2 }}
          empty={t.noProviders}
        />
      </section>
    </Desk>
  );
}
