'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '../../components/data-table';
import { Money } from '../../components/desk';
import { NameField } from '../../components/name-field';
import { useFactLine } from '../../components/package-facts';
import { RowMenu } from '../../components/row-menu';
import { Badge } from '../../components/ui/badge';
import type { Shelf } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

type Company = Shelf['companies'][number];
type Row = Company['providers'][number]['packages'][number] & { providerCode: string; providerName: string };

/** A package's own page: under its company, the catalog's root (spec 2026-11-09-admin-review, 4). */
export const packageHref = (companyCode: string, packageCode: string) =>
  `/companies/${encodeURIComponent(companyCode)}/packages/${encodeURIComponent(packageCode)}`;

/**
 * The company's «الرزم» tab (spec 2026-11-09-admin-review, 4): every package of the company in one table — its
 * facts, its provider, the main agent's price and renewal, the margin over the branch cost, on or off — with a
 * provider filter. Read-only here: each package is changed on its own page (its head holds on/off).
 */
export function CompanyPackages({ company, provider, onProvider, loading }: {
  company: Company | null;
  provider: string;
  onProvider: (code: string) => void;
  loading: boolean;
}) {
  const { t } = usePrefs();
  const router = useRouter();
  const factLine = useFactLine();
  const all: Row[] = (company?.providers ?? []).flatMap((item) => item.packages.map((pkg) => ({ ...pkg, providerCode: item.code, providerName: item.name })));
  const rows = provider ? all.filter((row) => row.providerCode === provider) : all;
  const open = (row: Row) => packageHref(company?.code ?? '', row.code);

  const columns: Column<Row>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (row) => (
        <span className="terms-name">
          <Link className="row-link" href={open(row)}><strong>{row.name}</strong></Link>
          {factLine(row) ? <span className="hint">{factLine(row)}</span> : null}
        </span>
      ),
    },
    { key: 'provider', header: t.provider, render: (row) => <Link className="row-link" href={`/providers/${encodeURIComponent(row.providerCode)}`}>{row.providerName}</Link> },
    {
      key: 'child',
      header: t.mainSellPair,
      num: true,
      render: (row) => (
        <span className="terms-pair">
          <Money value={row.mainPrice} />
          <span className="terms-pair-sep" aria-hidden="true">/</span>
          <Money value={row.renewalMainPrice} />
        </span>
      ),
    },
    { key: 'margin', header: t.margin, num: true, sortValue: (row) => row.mainPrice - row.branchCost, render: (row) => <Money value={row.mainPrice - row.branchCost} signed /> },
    { key: 'active', header: t.activeNumbers, num: true, sortValue: (row) => row.activeLines, render: (row) => row.activeLines },
    {
      key: 'status',
      header: t.status,
      render: (row) => <Badge variant={row.enabled ? 'success' : 'muted'} dot>{row.enabled ? t.lineActive : t.stopped}</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.rowActions}</span>,
      actions: true,
      render: (row) => <RowMenu label={`${t.rowActions} ${row.name}`} items={[{ label: t.openPackage, icon: 'enter', onClick: () => router.push(open(row)) }]} />,
    },
  ];

  return (
    <>
      {(company?.providers.length ?? 0) > 1 ? (
        <div className="pane-tools">
          <label className="inline-field">
            {t.provider}
            <NameField
              value={provider}
              allLabel={t.allRows}
              onChange={onProvider}
              options={(company?.providers ?? []).map((item) => ({ value: item.code, label: item.name, keys: [item.code] }))}
            />
          </label>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.providerCode}-${row.code}`}
        loading={loading}
        skeleton={{ rows: 5, columns: 7 }}
        empty={provider ? t.noMatches : t.noPackages}
      />
    </>
  );
}
