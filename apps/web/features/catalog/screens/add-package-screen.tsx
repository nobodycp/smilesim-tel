'use client';

import { Check, Plus, Search, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Desk, Money } from '../../../components/desk';
import { NameField } from '../../../components/name-field';
import { useFactLine } from '../../../components/package-facts';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { api, type ProviderCatalogProduct } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useOffice } from '../../../lib/office-session';
import { usePageTitle } from '../../../lib/page-title';
import { useCrumbs } from '../../../lib/crumbs';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { ChainBoard, RENEWAL_KEYS, SUBSCRIPTION_KEYS, type PriceKey } from '../chain-board';
import { packageHref } from '../company-packages';
import { InheritedModes, PACKAGE_ACTIONS } from '../inherited-modes';
import { DetailsFields, detailsDraft, readDetails, type DetailsDraft } from '../package-details-form';

type AddonDraft = { name: string; price: string; on: boolean };
type ModeChoice = 'auto' | 'manual' | 'off' | 'inherit';

const shekels = shekelField;

/**
 * «إضافة رزمة» (spec 2026-11-09-admin-review, 3): under a company, pick the provider and query it; pick one of its
 * products; then its details, its extra operations, how each operation runs (folded, from the provider unless set
 * here) and its prices — the package page's own editors — and save. The provider is simulated for now.
 */
export function AddPackageScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { me } = useOffice();
  const allowed = useRequireLayer(['branch']);
  const canEdit = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const shelf = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const providers = useApiQuery(sharedKeys.providers, () => api.officeProviders(), { enabled: allowed });
  const company = shelf.data?.companies.find((row) => row.code === params.code) ?? null;
  usePageTitle(t.addPackage);
  useCrumbs({
    [`/companies/${encodeURIComponent(params.code)}`]: company?.name,
    [`/companies/${encodeURIComponent(params.code)}/packages`]: t.packagesTab,
  });
  const factLine = useFactLine();

  const [provider, setProvider] = useState('');
  const [products, setProducts] = useState<ProviderCatalogProduct[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [product, setProduct] = useState<ProviderCatalogProduct | null>(null);
  const [name, setName] = useState('');
  const [months, setMonths] = useState('1');
  const [details, setDetails] = useState<DetailsDraft>(() => detailsDraft({ dataGb: null, smsCount: null, minutes: null }));
  const [addons, setAddons] = useState<AddonDraft[]>([]);
  const [modes, setModes] = useState<Record<string, ModeChoice>>({});
  const [prices, setPrices] = useState<Record<PriceKey, string>>(() => Object.fromEntries([...SUBSCRIPTION_KEYS, ...RENEWAL_KEYS].map((key) => [key, ''])) as Record<PriceKey, string>);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = useApiQuery(sharedKeys.providerSettings(provider), () => api.providerSettings(provider), { enabled: allowed && Boolean(provider) });
  const providerModes = settings.data?.modes ?? {};

  async function query() {
    if (!provider) return;
    setError('');
    setQuerying(true);
    setProduct(null);
    const result = await api.providerCatalogProducts(provider, params.code);
    setQuerying(false);
    if (!result.ok) {
      setProducts(null);
      setError(apiText(result));
      return;
    }
    setProducts(result.data.products);
    setSimulated(result.data.simulated);
  }

  function pick(next: ProviderCatalogProduct) {
    setProduct(next);
    setName(next.name);
    setMonths(String(next.months));
    setDetails(detailsDraft({ dataGb: next.dataGb, smsCount: next.smsCount, minutes: next.minutes, details: next.details }));
    setAddons(next.addons.map((addon) => ({ name: addon.name, price: shekels(addon.price), on: true })));
    setModes(Object.fromEntries(PACKAGE_ACTIONS.map((action) => [action, 'inherit'])));
    // Every layer starts at the provider's cost; the owner raises the rungs above it.
    const cost = shekels(next.cost);
    const renewal = shekels(next.renewalCost);
    setPrices(Object.fromEntries([...SUBSCRIPTION_KEYS.map((key) => [key, cost]), ...RENEWAL_KEYS.map((key) => [key, renewal])]) as Record<PriceKey, string>);
  }

  async function save() {
    if (!product) return;
    setError('');
    const facts = readDetails(details);
    const monthCount = Number(months);
    const ladder = (keys: readonly PriceKey[]) => keys.map((key) => parseShekel(prices[key]));
    const subscription = ladder(SUBSCRIPTION_KEYS);
    const renewal = ladder(RENEWAL_KEYS);
    const extras = addons.filter((addon) => addon.on).map((addon) => ({ name: addon.name.trim(), price: parseShekel(addon.price) }));
    if (!facts || !name.trim() || !Number.isInteger(monthCount) || monthCount < 1 || [...subscription, ...renewal].some((value) => value === null) || extras.some((addon) => !addon.name || addon.price === null)) {
      setError(t.errors.INVALID);
      return;
    }
    const rungs = (values: (number | null)[]) => ({ branchCost: values[0] as number, mainPrice: values[1] as number, agentPrice: values[2] as number, posPrice: values[3] as number, subscriberPrice: values[4] as number });
    setBusy(true);
    const result = await api.createPackage({
      providerCode: provider,
      companyCode: params.code,
      productCode: product.code,
      name: name.trim(),
      months: monthCount,
      ...facts,
      subscription: rungs(subscription),
      renewal: rungs(renewal),
      modes,
      addons: extras as { name: string; price: number }[],
    });
    setBusy(false);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    router.push(packageHref(result.data.companyCode, result.data.code));
  }

  if (!allowed) return null;
  const shownModes = Object.fromEntries(PACKAGE_ACTIONS.map((action) => [action, modes[action] === 'inherit' || !modes[action] ? providerModes[action] ?? 'manual' : modes[action]]));
  const inherited = PACKAGE_ACTIONS.filter((action) => !modes[action] || modes[action] === 'inherit');

  return (
    <Desk title={t.addPackage} lede={company ? `${t.company}: ${company.name}` : ''} error={error} note="">
      {!canEdit && me ? <p className="hint">{t.addNeedsEdit}</p> : null}

      <section className="pane add-step">
        <header className="pane-head"><h2><span className="step-no">1</span>{t.stepProvider}</h2></header>
        <div className="pane-body add-query">
          <label>
            {t.provider}
            <NameField
              value={provider}
              onChange={(next) => { setProvider(next); setProducts(null); setProduct(null); }}
              options={(providers.data?.providers ?? []).map((row) => ({ value: row.code, label: row.name, keys: [row.code] }))}
            />
          </label>
          <Button type="button" disabled={!provider || querying || !canEdit} onClick={() => void query()}>
            <Search size={16} aria-hidden="true" />
            {t.queryProvider}
          </Button>
        </div>
        {products ? (
          <div className="pane-body">
            {simulated ? <p className="hint">{t.simulatedProvider}</p> : null}
            {products.length === 0 ? <p className="hint">{t.noProviderProducts}</p> : (
              <div className="pick-grid" role="radiogroup" aria-label={t.providerProducts}>
                {products.map((row) => (
                  <button
                    key={row.code}
                    type="button"
                    role="radio"
                    aria-checked={product?.code === row.code}
                    className={product?.code === row.code ? 'pick-card on' : 'pick-card'}
                    disabled={row.added}
                    onClick={() => pick(row)}
                  >
                    <b>{row.name}</b>
                    <span className="hint">{factLine(row)}</span>
                    <span className="pick-cost">{t.providerCost}: <Money value={row.cost} /></span>
                    {row.added ? <Badge variant="muted">{t.alreadyAdded}</Badge> : null}
                    {product?.code === row.code ? <Check className="pick-tick" size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {product ? (
        <>
          <section className="pane add-step">
            <header className="pane-head"><h2><span className="step-no">2</span>{t.stepDetails}</h2></header>
            <div className="pane-body stack package-details-form">
              <div className="pair">
                <label>
                  {t.packageName}
                  <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  {t.months}
                  <input className="num" inputMode="numeric" dir="ltr" value={months} onChange={(event) => setMonths(event.target.value)} />
                </label>
              </div>
              <DetailsFields draft={details} onChange={setDetails} />
            </div>
          </section>

          <section className="pane add-step">
            <header className="pane-head"><h2><span className="step-no">3</span>{t.lineAddons}</h2></header>
            <div className="pane-body stack">
              <p className="hint">{t.addonsHint}</p>
              {addons.map((addon, index) => (
                <div key={index} className="addon-row">
                  <label className="check">
                    <input type="checkbox" checked={addon.on} onChange={(event) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, on: event.target.checked } : row)))} />
                    <span className="sr-only">{addon.name}</span>
                  </label>
                  <input aria-label={t.addonName} value={addon.name} onChange={(event) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)))} />
                  <input aria-label={t.amount} className="num" inputMode="decimal" dir="ltr" value={addon.price} onChange={(event) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, price: event.target.value } : row)))} />
                  <button type="button" className="icon-btn" aria-label={`${t.deleteAccount} ${addon.name}`} onClick={() => setAddons((list) => list.filter((_, at) => at !== index))}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddons((list) => [...list, { name: '', price: '', on: true }])}>
                  <Plus size={15} aria-hidden="true" />
                  {t.addAddon}
                </Button>
              </div>
            </div>
          </section>

          <section className="pane add-step">
            <header className="pane-head"><h2><span className="step-no">4</span>{t.howItRuns}</h2></header>
            <div className="pane-body">
              <InheritedModes
                modes={shownModes}
                inherited={inherited}
                disabled={!settings.loaded}
                onChange={(action, mode) => setModes((current) => ({ ...current, [action]: mode }))}
              />
            </div>
          </section>

          <section className="pane add-step">
            <header className="pane-head"><h2><span className="step-no">5</span>{t.chainTab}</h2></header>
            <p className="hint pane-hint">{t.pricesFromCost}</p>
            <ChainBoard prices={prices} onChange={(key, value) => setPrices((current) => ({ ...current, [key]: value }))} />
          </section>

          <div className="add-actions">
            <Button type="button" variant="secondary" onClick={() => router.push(`/companies/${encodeURIComponent(params.code)}`)}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !canEdit} onClick={() => void save()}>{t.savePackage}</Button>
          </div>
        </>
      ) : null}
    </Desk>
  );
}
