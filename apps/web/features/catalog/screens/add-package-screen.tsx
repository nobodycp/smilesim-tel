'use client';

import { Plus, Search, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Desk, Money, Pane } from '../../../components/desk';
import { NameField } from '../../../components/name-field';
import { useFactLine } from '../../../components/package-facts';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { IconButton } from '../../../components/ui/icon-button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { RadioCard, RadioCardGroup } from '../../../components/ui/radio-card';
import { api, type ProviderCatalogProduct } from '../../../lib/api';
import { parseShekel, shekelField } from '../../../lib/money';
import { useDesk } from '../../../lib/desk-session';
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
import { cn } from '../../../lib/cn';
import {
  addActionsClass,
  pickGridClass,
  pickNameClass,
  queryButtonClass,
  queryLabelClass,
  queryRowClass,
  stepAfterClass,
  stepNoClass,
  stepTitleClass,
} from '../add-steps';
import { paneHintClass } from '../sim-fields';

type AddonDraft = { name: string; price: string; on: boolean };
type ModeChoice = 'auto' | 'manual' | 'off' | 'inherit';

const shekels = shekelField;

/*
 * The look (Tailwind migration T4.4, ADR 0022): the steps are «إضافة شركة»'s (features/catalog/add-steps.ts). What is
 * this screen's own, ported from graphite.css, pane.css and responsive.css:
 * - a product card's facts a pane note, its cost 12px `--rd-ink-2`;
 * - the details step's body (`STEP_BODY`, the legacy `.stack` in a pane body): never wider than its column; the name
 *   and the months side by side 8px apart (one column under 768px);
 * - an add-on row: its box, its name, its price (8rem, 6rem under 768px) and its «×», 8px apart and centred; the box a
 *   pane label at least 36px high (44px under 721px);
 * - the chain step's note: a pane note 14px in from the pane's sides.
 */
const STEP_BODY = 'pane-body min-w-0 max-w-full';
/**
 * «إضافة رزمة» (spec 2026-11-09-admin-review, 3): under a company, pick the provider and query it; pick one of its
 * products; then its details, its extra operations, how each operation runs (folded, from the provider unless set
 * here) and its prices — the package page's own editors — and save. The provider is simulated for now.
 */
export function AddPackageScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { me } = useDesk();
  const allowed = useRequireLayer(['branch']);
  const canEdit = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')) && !me.impersonating);
  const shelf = useApiQuery(sharedKeys.companies, () => api.companies(), { enabled: allowed });
  const providers = useApiQuery(sharedKeys.providers, () => api.providers(), { enabled: allowed });
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
      {/* Outside a pane no legacy rule reached this note: a plain paragraph. */}
      {!canEdit && me ? <p>{t.addNeedsEdit}</p> : null}

      <Pane>
        <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>1</span>{t.stepProvider}</h2></header>
        <div className={queryRowClass}>
          <Label tone="pane" className={queryLabelClass}>
            {t.provider}
            <NameField
              value={provider}
              onChange={(next) => { setProvider(next); setProducts(null); setProduct(null); }}
              options={(providers.data?.providers ?? []).map((row) => ({ value: row.code, label: row.name, keys: [row.code] }))}
            />
          </Label>
          <Button type="button" className={queryButtonClass} disabled={!provider || querying || !canEdit} onClick={() => void query()}>
            <Search size={16} aria-hidden="true" />
            {t.queryProvider}
          </Button>
        </div>
        {products ? (
          <div className="pane-body">
            {simulated ? <p className={paneHintClass}>{t.simulatedProvider}</p> : null}
            {products.length === 0 ? <p className={paneHintClass}>{t.noProviderProducts}</p> : (
              <RadioCardGroup
                className={pickGridClass}
                aria-label={t.providerProducts}
                value={product?.code ?? ''}
                onValueChange={(code) => {
                  const next = products.find((row) => row.code === code);
                  if (next) pick(next);
                }}
              >
                {products.map((row) => (
                  <RadioCard key={row.code} value={row.code} data-slot="pick-card" disabled={row.added}>
                    <b className={pickNameClass}>{row.name}</b>
                    <span className={paneHintClass}>{factLine(row)}</span>
                    <span className="text-sm text-ink-2">{t.providerCost}: <Money value={row.cost} /></span>
                    {row.added ? <Badge variant="muted">{t.alreadyAdded}</Badge> : null}
                  </RadioCard>
                ))}
              </RadioCardGroup>
            )}
          </div>
        ) : null}
      </Pane>

      {product ? (
        <>
          <Pane className={stepAfterClass}>
            <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>2</span>{t.stepDetails}</h2></header>
            <div className={STEP_BODY}>
              <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
                <Label tone="pane">
                  {t.packageName}
                  <Input surface="surface" className="text-md" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </Label>
                <Label tone="pane">
                  {t.months}
                  <Input surface="surface" className="text-md" inputMode="numeric" dir="ltr" value={months} onChange={(event) => setMonths(event.target.value)} />
                </Label>
              </div>
              <DetailsFields draft={details} onChange={setDetails} />
            </div>
          </Pane>

          <Pane className={stepAfterClass}>
            <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>3</span>{t.lineAddons}</h2></header>
            <div className={STEP_BODY}>
              <p className={paneHintClass}>{t.addonsHint}</p>
              {addons.map((addon, index) => (
                <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_8rem_auto] items-center gap-2 max-md:grid-cols-[auto_minmax(0,1fr)_6rem_auto]">
                  <Label tone="pane" className="m-0 flex min-h-9 cursor-pointer items-center max-touch:min-h-11">
                    <Checkbox checked={addon.on} onCheckedChange={(next) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, on: next === true } : row)))} />
                    <span className="sr-only">{addon.name}</span>
                  </Label>
                  <Input surface="surface" className="text-md" aria-label={t.addonName} value={addon.name} onChange={(event) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, name: event.target.value } : row)))} />
                  <Input surface="surface" className="text-md" aria-label={t.amount} inputMode="decimal" dir="ltr" value={addon.price} onChange={(event) => setAddons((list) => list.map((row, at) => (at === index ? { ...row, price: event.target.value } : row)))} />
                  <IconButton aria-label={`${t.deleteAccount} ${addon.name}`} onClick={() => setAddons((list) => list.filter((_, at) => at !== index))}>
                    <X size={16} aria-hidden="true" />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddons((list) => [...list, { name: '', price: '', on: true }])}>
                  <Plus size={15} aria-hidden="true" />
                  {t.addAddon}
                </Button>
              </div>
            </div>
          </Pane>

          <Pane className={stepAfterClass}>
            <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>4</span>{t.howItRuns}</h2></header>
            <div className="pane-body">
              <InheritedModes
                modes={shownModes}
                inherited={inherited}
                disabled={!settings.loaded}
                onChange={(action, mode) => setModes((current) => ({ ...current, [action]: mode }))}
              />
            </div>
          </Pane>

          <Pane className={stepAfterClass}>
            <header className="pane-head"><h2 className={stepTitleClass}><span className={stepNoClass}>5</span>{t.chainTab}</h2></header>
            <p className={cn(paneHintClass, 'px-3.5')}>{t.pricesFromCost}</p>
            <ChainBoard prices={prices} onChange={(key, value) => setPrices((current) => ({ ...current, [key]: value }))} />
          </Pane>

          <div className={addActionsClass}>
            <Button type="button" variant="secondary" onClick={() => router.push(`/companies/${encodeURIComponent(params.code)}`)}>{t.cancel}</Button>
            <Button type="button" disabled={busy || !canEdit} onClick={() => void save()}>{t.savePackage}</Button>
          </div>
        </>
      ) : null}
    </Desk>
  );
}
