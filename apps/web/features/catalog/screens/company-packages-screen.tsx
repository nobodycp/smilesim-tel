'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk } from '../../../components/desk';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type Shelf } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { onOffTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';

const BRANCH = ['branch'];
type ShelfPackage = Shelf['companies'][number]['providers'][number]['packages'][number];

export function CompanyPackagesScreen() {
  const { t } = usePrefs();
  const params = useParams<{ code: string; provider: string }>();
  const allowed = useRequireLayer(BRANCH);
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const company = shelf.data?.companies.find((item) => item.code === params.code) ?? null;
  const provider = company?.providers.find((item) => item.code === params.provider) ?? null;
  const columns: Column<ShelfPackage>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (pkg) => (
        <Link className="row-link" href={`/providers/${params.provider}/${encodeURIComponent(pkg.code)}`}>{pkg.name}</Link>
      ),
    },
    { key: 'months', header: t.months, num: true, render: (pkg) => pkg.months },
    {
      key: 'sale',
      header: t.saleStatus,
      render: (pkg) => (
        <Badge variant={onOffTone(pkg.forSale)} dot>{pkg.forSale ? t.forSale : t.notForSale}</Badge>
      ),
    },
  ];

  return (
    <Desk title={provider?.name ?? ''} lede={company?.name ?? ''} error="" note="">
      <section className="pane">
        <DataTable
          columns={columns}
          rows={provider?.packages ?? []}
          rowKey={(pkg) => pkg.code}
          loading={!shelf.loaded}
          failed={shelf.error}
          onRetry={() => void shelf.reload()}
          skeleton={{ rows: 6, columns: 3 }}
          empty={t.noPackages}
        />
      </section>
    </Desk>
  );
}
