'use client';

import { Check, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Desk } from '../../../components/desk';
import { NameField } from '../../../components/name-field';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { api, type ProviderCatalogCompany } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useOffice } from '../../../lib/office-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { hasSimRules, simShape } from '../../../lib/sim-rules';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';

/**
 * «إضافة شركة» (spec 2026-11-09-admin-review, 3): pick the provider and query it; pick one of the companies it sells;
 * its name and SIM rules come from the provider and can be changed before saving. The provider is simulated for now.
 */
export function AddCompanyScreen() {
  const { t, apiText } = usePrefs();
  const router = useRouter();
  const { me } = useOffice();
  const allowed = useRequireLayer(['branch']);
  const canEdit = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const providers = useApiQuery(sharedKeys.providers, () => api.officeProviders(), { enabled: allowed });
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
      {!canEdit && me ? <p className="hint">{t.addNeedsEdit}</p> : null}
      <section className="pane add-step">
        <header className="pane-head"><h2><span className="step-no">1</span>{t.stepProvider}</h2></header>
        <div className="pane-body add-query">
          <label>
            {t.provider}
            <NameField
              value={provider}
              onChange={(next) => { setProvider(next); setOffered(null); setPicked(null); }}
              options={(providers.data?.providers ?? []).map((row) => ({ value: row.code, label: row.name, keys: [row.code] }))}
            />
          </label>
          <Button type="button" disabled={!provider || busy || !canEdit} onClick={() => void query()}>
            <Search size={16} aria-hidden="true" />
            {t.queryProvider}
          </Button>
        </div>
        {offered ? (
          <div className="pane-body">
            {simulated ? <p className="hint">{t.simulatedProvider}</p> : null}
            {offered.length === 0 ? <p className="hint">{t.noProviderCompanies}</p> : (
              <div className="pick-grid" role="radiogroup" aria-label={t.providerCompanies}>
                {offered.map((row) => (
                  <button
                    key={row.code}
                    type="button"
                    role="radio"
                    aria-checked={picked?.code === row.code}
                    className={picked?.code === row.code ? 'pick-card on' : 'pick-card'}
                    disabled={row.added}
                    onClick={() => pick(row)}
                  >
                    <b>{row.name}</b>
                    <span className="hint" dir="ltr">{row.code}</span>
                    {row.added ? <Badge variant="muted">{t.alreadyAdded}</Badge> : null}
                    {picked?.code === row.code ? <Check className="pick-tick" size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {picked ? (
        <>
          <section className="pane add-step">
            <header className="pane-head"><h2><span className="step-no">2</span>{t.stepSim}</h2></header>
            <div className="pane-body company-sim">
              <fieldset className="sim-fields">
                <label>
                  {t.companyNameLabel}
                  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  {t.simLength}
                  <input value={length} inputMode="numeric" dir="ltr" onChange={(event) => setLength(event.target.value)} />
                  <span className="hint">{t.simLengthHint}</span>
                </label>
                <label>
                  {t.simPrefix}
                  <input value={prefix} inputMode="numeric" dir="ltr" onChange={(event) => setPrefix(event.target.value)} />
                  <span className="hint">{t.simPrefixHint}</span>
                </label>
                <div className="sim-toggle">
                  <label className="check">
                    <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
                    {t.simEsim}
                  </label>
                </div>
                <label>
                  {t.esimPriceCompany}
                  <input value={esimPrice} inputMode="decimal" dir="ltr" onChange={(event) => setEsimPrice(event.target.value)} />
                </label>
              </fieldset>
              <p className="sim-sample">
                <span>{t.simShape}</span>
                {hasSimRules(rules) ? <bdi dir="ltr">{simShape(rules)}</bdi> : <span className="hint">{t.simAny}</span>}
              </p>
            </div>
          </section>
          <div className="add-actions">
            <Button type="button" variant="secondary" onClick={() => router.push('/companies')}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !canEdit} onClick={() => void save()}>{t.saveCompany}</Button>
          </div>
        </>
      ) : null}
    </Desk>
  );
}
