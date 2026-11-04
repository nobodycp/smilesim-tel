'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ChangeEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Desk } from '../../components/desk';
import { RowMenu } from '../../components/row-menu';
import { api, type Shelf } from '../../lib/api';
import { hueOf, markOf, compactImage } from '../../lib/company-mark';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useLoad } from '../../lib/use-load';
import { useRequireLayer } from '../../lib/use-require-layer';

const BRANCH = ['branch'];
type Company = Shelf['companies'][number];

function totals(company: Company) {
  const packages = company.providers.flatMap((provider) => provider.packages);
  return {
    packages: packages.length,
    active: packages.reduce((sum, item) => sum + item.activeLines, 0),
    stopped: packages.reduce((sum, item) => sum + item.stoppedLines, 0),
  };
}

export default function CompaniesPage() {
  const { t, apiText } = usePrefs();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const pending = useRef('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const allowed = useRequireLayer(BRANCH);
  const shelf = useLoad(() => api.officeCompanies(), [], { enabled: allowed });
  const { run } = useAction({ setError, setNote, onDone: shelf.reload });

  async function onImage(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    const name = pending.current;
    pending.current = '';
    if (!picked || !name) return;
    const image = await compactImage(picked);
    if (!image) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    await run(() => api.setCompanyImage(name, image), { note: t.save });
  }

  const columns: Column<Company>[] = [
    {
      key: 'company',
      header: t.company,
      render: (company) => (
        <span className="company-head">
          {company.image ? (
            // A data URL the browser already holds: next/image has nothing to optimise, so a plain img is right.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="company-logo" src={company.image} alt="" />
          ) : (
            <span className="company-mark" style={{ background: `hsl(${hueOf(company.name)} 42% 42%)` }}>{markOf(company.name)}</span>
          )}
          <Link className="row-link" href={`/companies/${company.code}`}>{company.name}</Link>
        </span>
      ),
    },
    { key: 'providers', header: t.providersTitle, num: true, render: (company) => company.providers.length },
    { key: 'packages', header: t.navPlans, num: true, render: (company) => totals(company).packages },
    { key: 'active', header: t.activeNumbers, num: true, render: (company) => totals(company).active },
    { key: 'stopped', header: t.stoppedLines, num: true, render: (company) => totals(company).stopped },
    {
      key: 'ops',
      header: t.quickActions,
      actions: true,
      render: (company) => (
        <RowMenu
          label={`${t.quickActions} ${company.name}`}
          items={[
            { label: t.edit, icon: 'edit', onClick: () => router.push(`/companies/${company.code}`) },
            {
              label: t.companyImage,
              icon: 'image',
              onClick: () => {
                pending.current = company.name;
                file.current?.click();
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Desk title={allowed ? t.companiesTitle : ''} lede="" error={error || shelf.error} note={note}>
      <input
        ref={file}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={t.companyImage}
        onChange={(event) => void onImage(event)}
      />
      <section className="pane">
        <DataTable
          columns={columns}
          rows={shelf.data?.companies ?? []}
          rowKey={(company) => company.code}
          loading={!shelf.loaded}
          skeleton={{ rows: 11, columns: 6 }}
          empty={t.noCompanies}
        />
      </section>
    </Desk>
  );
}
