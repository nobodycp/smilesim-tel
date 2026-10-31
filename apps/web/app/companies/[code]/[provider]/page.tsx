'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DataTable, type Column } from '../../../../components/data-table';
import { Desk } from '../../../../components/desk';
import { api, type Shelf } from '../../../../lib/api';
import { usePrefs } from '../../../../lib/prefs';
import { useLoad } from '../../../../lib/use-load';
import { useRequireLayer } from '../../../../lib/use-require-layer';

const BRANCH = ['branch'];
type ShelfPackage = Shelf['companies'][number]['providers'][number]['packages'][number];

export default function CompanyPackagesPage() {
  const { t } = usePrefs();
  const params = useParams<{ code: string; provider: string }>();
  const allowed = useRequireLayer(BRANCH);
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });
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
        <span className={pkg.forSale ? 'badge' : 'badge cancelled'}>{pkg.forSale ? t.forSale : t.notForSale}</span>
      ),
    },
  ];

  return (
    <Desk title={provider?.name ?? ''} lede={company?.name ?? ''} error={shelf.error} note="">
      <Link className="back-link" href={`/companies/${params.code}`}>{company?.name ?? t.companiesTitle}</Link>
      <section className="pane">
        <DataTable
          columns={columns}
          rows={provider?.packages ?? []}
          rowKey={(pkg) => pkg.code}
          loading={!shelf.loaded}
          skeleton={{ rows: 6, columns: 3 }}
          empty={t.noPackages}
        />
      </section>
    </Desk>
  );
}
