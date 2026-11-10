'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk } from '../../../components/desk';
import { DataImage } from '../../../components/data-image';
import { compactImage, markColor, markOf } from '../../../lib/company-mark';
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
import { Button, buttonClass } from '../../../components/ui/button';
import { ImageUp, Plus, Trash2 } from 'lucide-react';
import { LiveSwitch } from '../../../components/live-switch';
import { Tabs } from '../../../components/tabs';
import { useUrlFilters } from '../../../lib/url-state';
import { CompanyPackages } from '../company-packages';

const BRANCH = ['branch'];
type Provider = Shelf['companies'][number]['providers'][number];
type Tab = 'packages' | 'providers' | 'settings';
const TABS: readonly Tab[] = ['packages', 'providers', 'settings'];
const URL_KEYS = ['tab', 'provider'] as const;
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
  // The tab and the provider filter live in the address: `/companies/[c]?provider=[p]` opens its packages filtered
  // (the old `/companies/[c]/[p]` page lands there; spec 2026-11-09-admin-review, 4).
  const [filters, setFilters] = useUrlFilters(URL_KEYS);
  const tab: Tab = TABS.includes(filters.tab as Tab) ? (filters.tab as Tab) : 'packages';
  const setTab = (next: Tab) => setFilters({ tab: next === 'packages' ? '' : next });
  const [edited, setEdited] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const { run, busy } = useAction({ setError, setNote, onDone: shelf.reload });
  const company = shelf.data?.companies.find((item) => item.code === params.code) ?? null;
  usePageTitle(company?.name ?? '');
  // Impersonating reads only: the server refuses every write, so no control offers one.
  const canEdit = Boolean((me?.isBranchOwner || me?.grants?.includes('edit')) && !me?.impersonating);
  const draft = edited?.code === params.code ? edited : draftOf(params.code, company?.sim ?? OPEN_SIM, company?.esimPrice ?? 500);
  const shown = rulesOf(draft);

  const file = useRef<HTMLInputElement>(null);
  // The picture is saved the moment it is picked or removed; the SIM and eSIM settings wait for «حفظ».
  async function onImage(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const image = await compactImage(picked);
    if (!image) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setCompanyImage(params.code, image), { note: t.saved });
  }

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
        <Link className="row-link" href={`/providers/${encodeURIComponent(provider.code)}`}>{provider.name}</Link>
      ),
    },
    {
      key: 'packages',
      header: t.navPlans,
      num: true,
      // Its packages for this company: the «الرزم» tab filtered by it.
      render: (provider) => (
        <button type="button" className="link-btn" onClick={() => setFilters({ tab: '', provider: provider.code })}>
          {provider.packages.length}
        </button>
      ),
    },
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

  // The company is the catalog's root (spec 2026-11-09-admin-review, 4): its packages in one table with their
  // provider, the providers that serve it, and its own settings (SIM rules and the eSIM default).
  const packageCount = (company?.providers ?? []).reduce((sum, provider) => sum + provider.packages.length, 0);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'packages', label: t.packagesTab, count: packageCount || undefined },
    { key: 'providers', label: t.providersTitle, count: company?.providers.length || undefined },
    { key: 'settings', label: t.settingsTitle },
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
      lede={company ? [t.coPackages.replace('{n}', String(packageCount)), t.coProviders.replace('{n}', String(company.providers.length)), company.sim?.esim ? t.esimSupported : ''].filter(Boolean).join(' · ') : ''}
      // A package from one of the providers' products (spec 2026-11-09-admin-review, 3): owner or the edit grant.
      action={canEdit ? (
        <Link className={buttonClass({})} href={`/companies/${encodeURIComponent(params.code)}/packages/new`}><Plus size={16} aria-hidden="true" />{t.addPackage}</Link>
      ) : undefined}
      error={error}
      note={note}
    >
      <section className={tab === 'settings' ? 'pane fit' : 'pane'}>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {tab === 'settings' && (
          // Three blocks (spec 2026-11-11-ui-consistency-pass, D2): the picture, the SIM rules, eSIM.
          <div className="pane-body company-settings">
            <section className="settings-block">
              <h3>{t.companyImage}</h3>
              <div className="company-image-row">
                {company?.image ? <DataImage className="co-mark big" src={company.image} alt="" /> : <span className="co-mark big" style={{ background: markColor(company?.name ?? '?') }} aria-hidden="true">{markOf(company?.name ?? '?')}</span>}
                {canEdit ? (
                  <div className="company-image-actions">
                    <Button type="button" variant="secondary" disabled={busy || !company} onClick={() => file.current?.click()}><ImageUp size={16} aria-hidden="true" />{t.uploadImage}</Button>
                    {company?.image ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => api.setCompanyImage(params.code, null), { note: t.saved })}><Trash2 size={16} aria-hidden="true" />{t.removeImage}</Button> : null}
                    <span className="hint">{t.companyImageHint}</span>
                    <input ref={file} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label={t.companyImage} tabIndex={-1} onChange={(event) => void onImage(event)} />
                  </div>
                ) : null}
              </div>
            </section>
            <form className="settings-block company-sim" onSubmit={save}>
              <h3>{t.simRulesTitle}</h3>
              <fieldset className="sim-fields" disabled={!shelf.loaded || !canEdit}>
                <label>
                  {t.simLength}
                  <input value={draft.length} inputMode="numeric" dir="ltr" onChange={(event) => change({ length: event.target.value })} />
                  <span className="hint">{t.simLengthHint}</span>
                </label>
                <label>
                  {t.simPrefix}
                  <input value={draft.prefix} inputMode="numeric" dir="ltr" onChange={(event) => change({ prefix: event.target.value })} />
                  <span className="hint">{t.simPrefixHint}</span>
                </label>
              </fieldset>
              <p className="sim-sample">
                <span>{t.simShape}</span>
                {hasSimRules(shown) ? <bdi dir="ltr">{simShape(shown)}</bdi> : <span className="hint">{t.simAny}</span>}
              </p>
              <h3>eSIM</h3>
              <fieldset className="sim-fields" disabled={!shelf.loaded || !canEdit}>
                <div className="sim-toggle">
                  <LiveSwitch label={t.simEsim} checked={draft.esim} disabled={!shelf.loaded || !canEdit} onChange={(next) => change({ esim: next })}>
                    <b>{t.simEsim}</b>
                  </LiveSwitch>
                  <span className="hint">{t.simEsimHint}</span>
                </div>
                <label>
                  {t.esimPriceCompany}
                  <input value={draft.esimPrice} inputMode="decimal" dir="ltr" disabled={!draft.esim} onChange={(event) => change({ esimPrice: event.target.value })} />
                  <span className="hint">{t.esimPriceCompanyHint}</span>
                </label>
              </fieldset>
              {canEdit && <div className="form-save"><Button type="submit" disabled={busy || !shelf.loaded}>{t.save}</Button></div>}
            </form>
          </div>
        )}
        {tab === 'packages' && (
          <CompanyPackages
            company={company}
            provider={filters.provider}
            onProvider={(code) => setFilters({ provider: code })}
            loading={!shelf.loaded}
            busy={busy}
            onEnabled={canEdit ? (code, enabled) => void run(() => api.setPackageMode(code, { enabled }), { note: t.saved }) : undefined}
          />
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
