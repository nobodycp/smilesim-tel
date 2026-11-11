'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { ModeCards } from '../../../components/mode-cards';
import { LoadFailed } from '../../../components/load-failed';
import { Desk } from '../../../components/desk';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api } from '../../../lib/api';
import { formatShekel, parseShekel, shekelField } from '../../../lib/money';
import { Link2 } from 'lucide-react';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Button, buttonClass } from '../../../components/ui/button';
import { Tabs } from '../../../components/tabs';

const BRANCH = ['branch'];
const actions = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim', 'companySwitch'] as const;
type ModeAction = (typeof actions)[number];
type Tab = 'settings' | 'companies';

type PackageLine = {
  code: string;
  name: string;
  company: string;
  companyCode: string;
  active: number;
  stopped: number;
};
/** A company this provider serves, with its packages here and their numbers. */
type CompanyLine = { code: string; name: string; packages: number; active: number; stopped: number };

export function ProviderPackagesScreen() {
  const { t } = usePrefs();
  const params = useParams<{ code: string }>();
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const allowed = useRequireLayer(BRANCH);
  const providers = useApiQuery(sharedKeys.providers, () => api.officeProviders(), { enabled: allowed });
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const settings = useApiQuery(sharedKeys.providerSettings(params.code), () => api.providerSettings(params.code), { enabled: allowed });
  const { run } = useAction({ setError, setNote, onDone: settings.reload });
  const provider = providers.data?.providers.find((row) => row.code === params.code) ?? null;
  const named = shelf.data?.companies
    .flatMap((company) => company.providers)
    .find((item) => item.code === params.code)?.name;
  const title = settings.data?.name || provider?.name || named || '';

  const fromShelf: PackageLine[] | null = shelf.data
    ? shelf.data.companies.flatMap((company) => {
      const match = company.providers.find((item) => item.code === params.code);
      if (!match) return [];
      return match.packages.map((item) => ({
        code: item.code,
        name: item.name,
        company: company.name,
        companyCode: company.code,
        active: item.activeLines,
        stopped: item.stoppedLines,
      }));
    })
    : null;

  const rows = fromShelf ?? (provider?.companies ?? []).flatMap((company) => (
    company.packages.map((item) => ({
      code: item.code,
      name: item.name,
      company: company.name,
      // The providers list names its companies without their code; the shelf, read beside it, has it.
      companyCode: '',
      active: 0,
      stopped: 0,
    }))
  ));

  const names: Record<ModeAction, string> = {
    activate: t.actActivate,
    charge: t.actCharge,
    extend: t.extend,
    disconnect: t.actDisconnect,
    freeze: `${t.freeze} / ${t.unfreeze}`,
    switch: t.actSwitch,
    rename: t.changeNumber,
    sim: t.swapSim,
    companySwitch: t.actCompanySwitch,
  };

  async function saveMode(action: string, mode: string) {
    await run(() => api.setProviderMode(params.code, action, mode));
  }

  const storedPrice = settings.data?.esimPrice ?? null;
  const priceField = priceDraft ?? (storedPrice === null ? '' : shekelField(storedPrice));

  async function savePrice(event: FormEvent) {
    event.preventDefault();
    const text = priceField.trim();
    const price = text ? parseShekel(text) : null;
    if (text && price === null) {
      setError(t.errors.INVALID);
      setNote('');
      return;
    }
    await run(() => api.setProviderEsimPrice(params.code, price), { note: t.save, then: () => setPriceDraft(null) });
  }

  // The head as in the design: the companies it supplies, its packages and your balance with it; the account beside.
  const { me } = useOffice();
  const canAccount = Boolean(me?.isBranchOwner || me?.grants?.includes('accounting'));
  const accounts = useApiQuery(['office', 'provider-accounts'], () => api.providerAccounts(), { enabled: canAccount });
  const account = accounts.data?.rows.find((row) => row.code === params.code);
  const companiesOf = [...new Set(rows.map((row) => row.company).filter(Boolean))];

  // Its packages live under their companies (spec 2026-11-09-admin-review, 4): this page lists the companies it
  // serves, each opening that company's «الرزم» filtered by this provider. Run defaults and the eSIM price stay here.
  const companies = rows.reduce<CompanyLine[]>((list, row) => {
    const found = list.find((item) => item.name === row.company);
    if (found) {
      found.packages += 1;
      found.active += row.active;
      found.stopped += row.stopped;
    } else list.push({ code: row.companyCode, name: row.company, packages: 1, active: row.active, stopped: row.stopped });
    return list;
  }, []);
  const columns: Column<CompanyLine>[] = [
    {
      key: 'company',
      header: t.company,
      render: (row) => (row.code
        ? <Link className="row-link" href={`/companies/${encodeURIComponent(row.code)}?provider=${encodeURIComponent(params.code)}`}>{row.name}</Link>
        : row.name),
    },
    { key: 'packages', header: t.navPlans, num: true, render: (row) => row.packages },
    { key: 'active', header: t.activeNumbers, num: true, render: (row) => row.active },
    { key: 'stopped', header: t.stoppedLines, num: true, render: (row) => row.stopped },
  ];

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'settings', label: t.runMethodTab },
    { key: 'companies', label: t.companiesColumn, count: companies.length || undefined },
  ];

  return (
    <Desk
      title={title}
      lede={[
        companiesOf.length ? t.suppliesCompanies.replace('{companies}', companiesOf.join(' · ')) : '',
        t.coPackages.replace('{n}', String(rows.length)),
        account ? t.yourBalanceThere.replace('{amount}', formatShekel(account.balance)) : '',
      ].filter(Boolean).join(' · ')}
      action={canAccount ? (
        <Link className={buttonClass({ variant: 'secondary' })} href={`/provider-accounts/${params.code}`}>
          <Link2 size={16} strokeWidth={1.9} aria-hidden="true" />
          {t.providerAccountLink}
        </Link>
      ) : undefined}
      error={error}
      note={note}
    >
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <section className={tab === 'settings' ? 'pane line-pane' : 'pane'}>
        {tab === 'settings' && (
          <div className="pane-body stack">
            {settings.error ? (
              <LoadFailed message={settings.error} onRetry={() => void settings.reload()} />
            ) : (
              <ModeCards
                actions={actions}
                names={names}
                modes={settings.data?.modes ?? {}}
                disabled={!settings.loaded}
                onChange={(action, mode) => void saveMode(action, mode)}
              />
            )}
            <form className="switch-row" onSubmit={savePrice}>
              <label>
                {t.esimPrice}
                <input
                  value={priceField}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder={t.useInheritedPrice}
                  disabled={!settings.loaded}
                  onChange={(event) => setPriceDraft(event.target.value)}
                />
                <span className="hint">{t.esimPriceProviderHint}</span>
              </label>
              <Button type="submit" disabled={!settings.loaded}>{t.save}</Button>
            </form>
          </div>
        )}
        {tab === 'companies' && (
          <DataTable
            columns={columns}
            rows={companies}
            rowKey={(row) => row.name}
            loading={!providers.loaded && !shelf.loaded}
            failed={providers.error || shelf.error}
            onRetry={() => { void providers.reload(); void shelf.reload(); }}
            skeleton={{ rows: 6, columns: 4 }}
            empty={t.noLines}
          />
        )}
      </section>
    </Desk>
  );
}
