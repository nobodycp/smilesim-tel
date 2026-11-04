'use client';

import Link from 'next/link';
import { DataTable, type Column } from '../../components/data-table';
import { Desk } from '../../components/desk';
import { api, type ProviderRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useLoad } from '../../lib/use-load';
import { useRequireLayer } from '../../lib/use-require-layer';

const BRANCH = ['branch'];

export default function ProvidersPage() {
  const { t } = usePrefs();
  const allowed = useRequireLayer(BRANCH);
  const providers = useLoad(() => api.officeProviders(), [], { enabled: allowed });
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });

  function census(code: string) {
    const packages = (shelf.data?.companies ?? []).flatMap((company) => (
      company.providers.filter((item) => item.code === code).flatMap((item) => item.packages)
    ));
    return {
      active: packages.reduce((sum, item) => sum + item.activeLines, 0),
      stopped: packages.reduce((sum, item) => sum + item.stoppedLines, 0),
    };
  }

  const columns: Column<ProviderRow>[] = [
    { key: 'provider', header: t.provider, render: (provider) => <Link className="row-link" href={`/providers/${provider.code}`}>{provider.name}</Link> },
    { key: 'companies', header: t.company, num: true, render: (provider) => provider.companies.length },
    { key: 'packages', header: t.navPlans, num: true, render: (provider) => provider.companies.reduce((sum, company) => sum + company.packages.length, 0) },
    { key: 'active', header: t.activeNumbers, num: true, render: (provider) => census(provider.code).active },
    { key: 'stopped', header: t.stoppedLines, num: true, render: (provider) => census(provider.code).stopped },
  ];

  return (
    <Desk title={allowed ? t.providersTitle : ''} lede="" error={providers.error || shelf.error} note="">
      <section className="pane">
        <DataTable columns={columns} rows={providers.data?.providers ?? []} rowKey={(provider) => provider.code} loading={!providers.loaded} skeleton={{ rows: 5, columns: 5 }} />
      </section>
    </Desk>
  );
}
