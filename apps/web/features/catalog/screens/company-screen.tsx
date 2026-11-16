'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { CompanyMark } from '../../../components/company-mark';
import { Desk, Pane } from '../../../components/desk';
import { compactImage } from '../../../lib/company-mark';
import { usePageTitle } from '../../../lib/page-title';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type Shelf, type SimRules } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ImageUp, Plus, Trash2 } from 'lucide-react';
import { LiveSwitch } from '../../../components/live-switch';
import { Tabs } from '../../../components/tabs';
import { useUrlFilters } from '../../../lib/url-state';
import { cn } from '../../../lib/cn';
import { CompanyPackages } from '../company-packages';
import { SimFields, SimSample, paneHintClass, simToggleClass } from '../sim-fields';

const BRANCH = ['branch'];
type Provider = Shelf['companies'][number]['providers'][number];
type Tab = 'packages' | 'providers' | 'settings';
const TABS: readonly Tab[] = ['packages', 'providers', 'settings'];
const URL_KEYS = ['tab', 'provider'] as const;
type Draft = { code: string; length: string; prefix: string; esim: boolean; esimPrice: string };

/*
 * The settings tab (Tailwind migration T4.3, ADR 0022), ported from graphite.css and pane.css: two blocks in a pane
 * body with no padding or gap of its own, each a grid with 16px padding, the second under a 1px `--rd-line` rule; the
 * picture block's rows 12px apart, the SIM form's 8px (`.pane form` outranked the block's 12px). A block's heading is
 * 13.5px bold ink with no margin; a later heading inside a block sits 8px lower over a dashed `--rd-line` rule, 12px
 * inside it.
 */
const BLOCK_TITLE = 'm-0 text-block font-bold text-ink';
const BLOCK_SUBTITLE = cn(BLOCK_TITLE, 'mt-2 border-t border-dashed border-line pt-3');

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
  const { me } = useDesk();
  // The tab and the provider filter live in the address: `/companies/[c]?provider=[p]` opens its packages filtered
  // (the old `/companies/[c]/[p]` page lands there; spec 2026-11-09-admin-review, 4).
  const [filters, setFilters] = useUrlFilters(URL_KEYS);
  const tab: Tab = TABS.includes(filters.tab as Tab) ? (filters.tab as Tab) : 'packages';
  const setTab = (next: Tab) => setFilters({ tab: next === 'packages' ? '' : next });
  const [edited, setEdited] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const shelf = useApiQuery(sharedKeys.companies, () => api.companies(), { enabled: allowed });
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
        <Link className="font-bold" href={`/providers/${encodeURIComponent(provider.code)}`}>{provider.name}</Link>
      ),
    },
    {
      key: 'packages',
      header: t.navPlans,
      num: true,
      // Its packages for this company: the «الرزم» tab filtered by it.
      render: (provider) => (
        <Button type="button" variant="link" onClick={() => setFilters({ tab: '', provider: provider.code })}>
          {provider.packages.length}
        </Button>
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
        // Graphite: the company's cut-corner mark beside its name, 12px apart, wrapping (legacy `.ticket-title`).
        <span className="inline-flex flex-wrap items-center gap-3">
          <CompanyMark name={company.name} image={company.image} size="lg" />
          <span>{company.name}</span>
        </span>
      ) : ''}
      lede={company ? [t.coPackages.replace('{n}', String(packageCount)), t.coProviders.replace('{n}', String(company.providers.length)), company.sim?.esim ? t.esimSupported : ''].filter(Boolean).join(' · ') : ''}
      // A package from one of the providers' products (spec 2026-11-09-admin-review, 3): owner or the edit grant.
      action={canEdit ? (
        <Button asChild><Link href={`/companies/${encodeURIComponent(params.code)}/packages/new`}><Plus size={16} aria-hidden="true" />{t.addPackage}</Link></Button>
      ) : undefined}
      error={error}
      note={note}
    >
      {/* Tabs sit above their content on every page (owner 2026-11-11). */}
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {/* Settings: three blocks (spec 2026-11-11-ui-consistency-pass, D2): the picture, the SIM rules, eSIM. */}
      {tab === 'settings' && (
        <Pane>
          <div className="pane-body gap-0 p-0">
            <section className="grid gap-3 p-4">
              <h3 className={BLOCK_TITLE}>{t.companyImage}</h3>
              <div className="flex flex-wrap items-center gap-3">
                {/* The picture shown whole on `--rd-surface-2`, 64px with 22px letters (legacy `.company-image-row`). */}
                <CompanyMark name={company?.name ?? '?'} image={company?.image} size="lg" className="size-16 bg-surface-2 object-contain text-4xl" />
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" disabled={busy || !company} onClick={() => file.current?.click()}><ImageUp size={16} aria-hidden="true" />{t.uploadImage}</Button>
                    {company?.image ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => api.setCompanyImage(params.code, null), { note: t.saved })}><Trash2 size={16} aria-hidden="true" />{t.removeImage}</Button> : null}
                    <span className={cn(paneHintClass, 'basis-full')}>{t.companyImageHint}</span>
                    <input ref={file} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label={t.companyImage} tabIndex={-1} onChange={(event) => void onImage(event)} />
                  </div>
                ) : null}
              </div>
            </section>
            <form className="grid content-start gap-2 border-t border-line p-4" onSubmit={save}>
              <h3 className={BLOCK_TITLE}>{t.simRulesTitle}</h3>
              <SimFields disabled={!shelf.loaded || !canEdit}>
                <Label tone="pane">
                  {t.simLength}
                  <Input surface="surface" className="text-md" value={draft.length} inputMode="numeric" dir="ltr" onChange={(event) => change({ length: event.target.value })} />
                  <span className={paneHintClass}>{t.simLengthHint}</span>
                </Label>
                <Label tone="pane">
                  {t.simPrefix}
                  <Input surface="surface" className="text-md" value={draft.prefix} inputMode="numeric" dir="ltr" onChange={(event) => change({ prefix: event.target.value })} />
                  <span className={paneHintClass}>{t.simPrefixHint}</span>
                </Label>
              </SimFields>
              <SimSample rules={shown} />
              <h3 className={BLOCK_SUBTITLE}>eSIM</h3>
              <SimFields disabled={!shelf.loaded || !canEdit}>
                {/* In a settings block the switch and its note sit in the middle of their cell. */}
                <div className={cn(simToggleClass, 'content-center')}>
                  <LiveSwitch className="justify-start" label={t.simEsim} checked={draft.esim} disabled={!shelf.loaded || !canEdit} onChange={(next) => change({ esim: next })}>
                    <b>{t.simEsim}</b>
                  </LiveSwitch>
                  <span className={paneHintClass}>{t.simEsimHint}</span>
                </div>
                <Label tone="pane">
                  {t.esimPriceCompany}
                  <Input surface="surface" className="text-md" value={draft.esimPrice} inputMode="decimal" dir="ltr" disabled={!draft.esim} onChange={(event) => change({ esimPrice: event.target.value })} />
                  <span className={paneHintClass}>{t.esimPriceCompanyHint}</span>
                </Label>
              </SimFields>
              {/* The save row (legacy `.form-save`): at the start, 4px lower, 12px inside a 1px `--rd-line` rule. */}
              {canEdit && <div className="mt-1 flex justify-start border-t border-line pt-3"><Button type="submit" disabled={busy || !shelf.loaded}>{t.save}</Button></div>}
            </form>
          </div>
        </Pane>
        )}
        {tab === 'packages' && (
          <CompanyPackages
            company={company}
            provider={filters.provider}
            onProvider={(code) => setFilters({ provider: code })}
            loading={!shelf.loaded}
            busy={busy}
            onEnabled={canEdit ? (code, enabled, name) => void run(() => api.setPackageMode(code, { enabled }), { note: (enabled ? t.packageTurnedOn : t.packageTurnedOff).replace('{name}', name) }) : undefined}
          />
        )}
        {tab === 'providers' && (
          <Pane>
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
          </Pane>
        )}
    </Desk>
  );
}
