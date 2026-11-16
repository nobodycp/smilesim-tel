'use client';

import { Check, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Desk, Pane } from '../../../components/desk';
import { NameField } from '../../../components/name-field';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { api, type ProviderCatalogCompany } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import {
  addActionsClass,
  pickCardClass,
  pickGridClass,
  pickNameClass,
  pickTickClass,
  queryButtonClass,
  queryLabelClass,
  queryRowClass,
  stepAfterClass,
  stepNoClass,
  stepTitleClass,
} from '../add-steps';
import { SimFields, SimSample, paneHintClass, simToggleClass } from '../sim-fields';

/*
 * The steps' look is shared with «إضافة رزمة» (features/catalog/add-steps.ts). What is this screen's own, ported from
 * graphite.css and pane.css (Tailwind migration T4.3): a company card's code is a pane note; the eSIM box is a pane
 * label laid out as a row 4px apart, at least 36px high (44px under 721px), its words at 11px `--rd-muted` 600 (the
 * pane's label rule outranked `.check`'s 13px ink).
 */

/**
 * «إضافة شركة» (spec 2026-11-09-admin-review, 3): pick the provider and query it; pick one of the companies it sells;
 * its name and SIM rules come from the provider and can be changed before saving. The provider is simulated for now.
 */
export function AddCompanyScreen() {
  const { t, apiText } = usePrefs();
  const router = useRouter();
  const { me } = useDesk();
  const allowed = useRequireLayer(['branch']);
  const canEdit = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const providers = useApiQuery(sharedKeys.providers, () => api.providers(), { enabled: allowed });
  usePageTitle(t.addCompany);

  const [provider, setProvider] = useState('');
  const [offered, setOffered] = useState<ProviderCatalogCompany[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [picked, setPicked] = useState<ProviderCatalogCompany | null>(null);
  const [name, setName] = useState('');
  const [length, setLength] = useState('');
  const [prefix, setPrefix] = useState('');
  const [esim, setEsim] = useState(true);
  const [esimPrice, setEsimPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function query() {
    if (!provider) return;
    setError('');
    setBusy(true);
    setPicked(null);
    const result = await api.providerCatalogCompanies(provider);
    setBusy(false);
    if (!result.ok) {
      setOffered(null);
      setError(apiText(result));
      return;
    }
    setOffered(result.data.companies);
    setSimulated(result.data.simulated);
  }

  function pick(next: ProviderCatalogCompany) {
    setPicked(next);
    setName(next.name);
    setLength(next.sim.length === null ? '' : String(next.sim.length));
    setPrefix(next.sim.prefix);
    setEsim(next.sim.esim);
    setEsimPrice(shekelField(next.esimPrice));
  }

  async function save() {
    if (!picked) return;
    setError('');
    const price = parseShekel(esimPrice);
    const digits = length.trim();
    if (!name.trim() || price === null || (digits && !/^\d+$/.test(digits)) || (prefix.trim() && !/^\d+$/.test(prefix.trim()))) {
      setError(t.errors.INVALID);
      return;
    }
    setBusy(true);
    const result = await api.createCompany({
      providerCode: provider,
      companyCode: picked.code,
      name: name.trim(),
      simLength: digits ? Number(digits) : null,
      simPrefix: prefix.trim(),
      esim,
      esimPrice: price,
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    router.push(`/companies/${encodeURIComponent(result.data.code)}`);
  }

  if (!allowed) return null;
  const rules = { length: length.trim() ? Number(length) : null, prefix: prefix.trim(), esim };

  return (
    <Desk title={t.addCompany} lede="" error={error} note="">
      {/* Outside a pane no legacy rule reached this note: a plain paragraph. */}
      {!canEdit && me ? <p>{t.addNeedsEdit}</p> : null}
      <Pane>
        <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>1</span>{t.stepProvider}</h2></header>
        <div className={queryRowClass}>
          <Label tone="pane" className={queryLabelClass}>
            {t.provider}
            <NameField
              value={provider}
              onChange={(next) => { setProvider(next); setOffered(null); setPicked(null); }}
              options={(providers.data?.providers ?? []).map((row) => ({ value: row.code, label: row.name, keys: [row.code] }))}
            />
          </Label>
          <Button type="button" className={queryButtonClass} disabled={!provider || busy || !canEdit} onClick={() => void query()}>
            <Search size={16} aria-hidden="true" />
            {t.queryProvider}
          </Button>
        </div>
        {offered ? (
          <div className="pane-body">
            {simulated ? <p className={paneHintClass}>{t.simulatedProvider}</p> : null}
            {offered.length === 0 ? <p className={paneHintClass}>{t.noProviderCompanies}</p> : (
              <div className={pickGridClass} role="radiogroup" aria-label={t.providerCompanies}>
                {offered.map((row) => (
                  <button
                    key={row.code}
                    type="button"
                    role="radio"
                    aria-checked={picked?.code === row.code}
                    className={pickCardClass}
                    data-slot="pick-card"
                    disabled={row.added}
                    onClick={() => pick(row)}
                  >
                    <b className={pickNameClass}>{row.name}</b>
                    <span className={paneHintClass} dir="ltr">{row.code}</span>
                    {row.added ? <Badge variant="muted">{t.alreadyAdded}</Badge> : null}
                    {picked?.code === row.code ? <Check className={pickTickClass} size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Pane>

      {picked ? (
        <>
          <Pane className={stepAfterClass}>
            <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>2</span>{t.stepSim}</h2></header>
            <div className="pane-body gap-3.5">
              <SimFields>
                <Label tone="pane">
                  {t.companyNameLabel}
                  <Input surface="surface" className="text-md" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </Label>
                <Label tone="pane">
                  {t.simLength}
                  <Input surface="surface" className="text-md" value={length} inputMode="numeric" dir="ltr" onChange={(event) => setLength(event.target.value)} />
                  <span className={paneHintClass}>{t.simLengthHint}</span>
                </Label>
                <Label tone="pane">
                  {t.simPrefix}
                  <Input surface="surface" className="text-md" value={prefix} inputMode="numeric" dir="ltr" onChange={(event) => setPrefix(event.target.value)} />
                  <span className={paneHintClass}>{t.simPrefixHint}</span>
                </Label>
                <div className={simToggleClass}>
                  <Label tone="pane" className="m-0 flex min-h-9 cursor-pointer items-center max-[721px]:min-h-11">
                    <Checkbox checked={esim} onCheckedChange={(next) => setEsim(next === true)} />
                    {t.simEsim}
                  </Label>
                </div>
                <Label tone="pane">
                  {t.esimPriceCompany}
                  <Input surface="surface" className="text-md" value={esimPrice} inputMode="decimal" dir="ltr" onChange={(event) => setEsimPrice(event.target.value)} />
                </Label>
              </SimFields>
              <SimSample rules={rules} />
            </div>
          </Pane>
          <div className={addActionsClass}>
            <Button type="button" variant="secondary" onClick={() => router.push('/companies')}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !canEdit} onClick={() => void save()}>{t.saveCompany}</Button>
          </div>
        </>
      ) : null}
    </Desk>
  );
}
