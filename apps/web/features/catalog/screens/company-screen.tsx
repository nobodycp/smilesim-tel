'use client';

import Link from 'next/link';
import { ChevronLeft, Package } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk } from '../../../components/desk';
import { DataImage } from '../../../components/data-image';
import { markColor, markOf } from '../../../lib/company-mark';
import { usePageTitle } from '../../../lib/page-title';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type Shelf, type SimRules } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simShape } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Button } from '../../../components/ui/button';
import { Tabs } from '../../../components/tabs';
import { useFactLine } from '../../../components/package-facts';

const BRANCH = ['branch'];
type Provider = Shelf['companies'][number]['providers'][number];
type Tab = 'packages' | 'settings' | 'providers';
type Draft = { code: string; length: string; prefix: string; esim: boolean; esimPrice: string };

function draftOf(code: string, sim: SimRules, esimPrice: number): Draft {
  return { code, length: sim.length === null ? '' : String(sim.length), prefix: sim.prefix, esim: sim.esim, esimPrice: shekelField(esimPrice) };
}

function rulesOf(draft: Draft): SimRules {
  const length = draft.length.trim();
  return { length: length ? Number(length) : null, prefix: draft.prefix.trim(), esim: draft.esim };
}

export function CompanyScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const allowed = useRequireLayer(BRANCH);
  const { me } = useOffice();
  const [tab, setTab] = useState<Tab>('packages');
  const [edited, setEdited] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const { run, busy } = useAction({ setError, setNote, onDone: shelf.reload });
  const company = shelf.data?.companies.find((item) => item.code === params.code) ?? null;
  usePageTitle(company?.name ?? '');
  const canEdit = Boolean(me?.isBranchOwner || me?.grants?.includes('edit'));
  const draft = edited?.code === params.code ? edited : draftOf(params.code, company?.sim ?? OPEN_SIM, company?.esimPrice ?? 500);
  const shown = rulesOf(draft);

  function change(patch: Partial<Draft>) {
    setEdited({ ...draft, ...patch });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const length = draft.length.trim();
    const esimPrice = parseShekel(draft.esimPrice);
    if ((length && !/^\d+$/.test(length)) || (draft.prefix.trim() && !/^\d+$/.test(draft.prefix.trim())) || esimPrice === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setCompanySim(params.code, { ...rulesOf(draft), esimPrice }), {
      note: t.simSaved,
      then: () => setEdited(null),
    });
  }

  const columns: Column<Provider>[] = [
    {
      key: 'provider',
      header: t.provider,
      render: (provider) => (
        <Link className="row-link" href={`/companies/${params.code}/${provider.code}`}>{provider.name}</Link>
      ),
    },
    { key: 'packages', header: t.navPlans, num: true, render: (provider) => provider.packages.length },
    {
      key: 'active',
      header: t.activeNumbers,
      num: true,
      render: (provider) => provider.packages.reduce((sum, item) => sum + item.activeLines, 0),
    },
    {
      key: 'stopped',
      header: t.stoppedLines,
      num: true,
      render: (provider) => provider.packages.reduce((sum, item) => sum + item.stoppedLines, 0),
    },
  ];

  // The company's packages first, as cards that open each package (Graphite); then its SIM rules and providers.
  const factLine = useFactLine();
  const packageCards = (company?.providers ?? []).flatMap((provider) => provider.packages.map((item) => ({ ...item, providerCode: provider.code, providerName: provider.name })));
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'packages', label: t.packagesTab, count: packageCards.length || undefined },
    { key: 'settings', label: t.companySettingsTab },
    { key: 'providers', label: t.providersTitle },
  ];

  return (
    <Desk
      title={company ? (
        // Graphite: the company's cut-corner mark beside its name.
        <span className="ticket-title">
          {company.image ? <DataImage className="co-mark big" src={company.image} alt="" /> : <span className="co-mark big" style={{ background: markColor(company.name) }} aria-hidden="true">{markOf(company.name)}</span>}
          <span>{company.name}</span>
        </span>
      ) : ''}
      lede={company ? `${t.packagesGroupSummary.replace('{total}', String(company.providers.reduce((sum, item) => sum + item.packages.length, 0))).replace(/ · .*$/, '')} · ${company.providers.length} ${t.providersTitle}` : ''}
      error={error}
      note={note}
    >
      <section className={tab === 'settings' ? 'pane fit' : 'pane'}>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {tab === 'settings' && (
          <form className="pane-body company-sim" onSubmit={save}>
            <fieldset className="sim-fields" disabled={!shelf.loaded || !canEdit}>
              <label>
                {t.simLength}
                <input
                  value={draft.length}
                  inputMode="numeric"
                  dir="ltr"
                  onChange={(event) => change({ length: event.target.value })}
                />
                <span className="hint">{t.simLengthHint}</span>
              </label>
              <label>
                {t.simPrefix}
                <input
                  value={draft.prefix}
                  inputMode="numeric"
                  dir="ltr"
                  onChange={(event) => change({ prefix: event.target.value })}
                />
                <span className="hint">{t.simPrefixHint}</span>
              </label>
              <div className="sim-toggle">
                <label className="check">
                  <input type="checkbox" checked={draft.esim} onChange={(event) => change({ esim: event.target.checked })} />
                  {t.simEsim}
                </label>
                <span className="hint">{t.simEsimHint}</span>
              </div>
              <label>
                {t.esimPriceCompany}
                <input
                  value={draft.esimPrice}
                  inputMode="decimal"
                  dir="ltr"
                  onChange={(event) => change({ esimPrice: event.target.value })}
                />
                <span className="hint">{t.esimPriceCompanyHint}</span>
              </label>
            </fieldset>
            <p className="sim-sample">
              <span>{t.simShape}</span>
              {hasSimRules(shown)
                ? <bdi dir="ltr">{simShape(shown)}</bdi>
                : <span className="hint">{t.simAny}</span>}
            </p>
            {canEdit && <Button type="submit" disabled={busy || !shelf.loaded}>{t.save}</Button>}
          </form>
        )}
        {tab === 'packages' && (
          <div className="pane-body">
            {packageCards.length === 0 ? (
              <p className="hint">{shelf.loaded ? t.noLines : ''}</p>
            ) : (
              <div className="line-op-grid">
                {packageCards.map((item) => (
                  <Link key={`${item.providerCode}-${item.code}`} className="line-op" href={`/providers/${item.providerCode}/${encodeURIComponent(item.code)}`}>
                    <span className="line-op-mark"><Package size={18} strokeWidth={1.9} aria-hidden="true" /></span>
                    <b>{item.name}</b>
                    <span className="line-op-text">{[item.providerName, factLine(item)].filter(Boolean).join(' · ')}</span>
                    <ChevronLeft className="line-op-go flip-ltr" size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'providers' && (
          <DataTable
            columns={columns}
            rows={company?.providers ?? []}
            rowKey={(provider) => provider.code}
            loading={!shelf.loaded}
            failed={shelf.error}
            onRetry={() => void shelf.reload()}
            skeleton={{ rows: 5, columns: 4 }}
            empty={t.noProviders}
          />
        )}
      </section>
    </Desk>
  );
}
