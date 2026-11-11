'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, layerName, lineStatus } from '../../../components/desk';
import { LinePricesDialog } from '../../../components/line-prices-dialog';
import { markColor, markOf } from '../../../lib/company-mark';
import { usePageTitle } from '../../../lib/page-title';
import { TableSkeleton } from '../../../components/loading';
import { PriceField } from '../../../components/price-field';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { api, type CustomPriceRow, type LineRow, type Shelf } from '../../../lib/api';
import { everyAccount } from '../../../lib/directory';
import { formatShekel, parseShekel, shekelField } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { type Fetched } from '../../../lib/fetched';
import { useApiQuery } from '../../../lib/use-api-query';
import { packageKeys, sharedKeys } from '../../../lib/query';
import { useQueryClient } from '@tanstack/react-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { useOffice } from '../../../lib/office-session';
import { lineTone, onOffTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';
import { NameField } from '../../../components/name-field';
import { InheritedModes } from '../inherited-modes';
import { ChainBoard, type PriceKey } from '../chain-board';
import { useCrumbs } from '../../../lib/crumbs';
import { Tabs } from '../../../components/tabs';
import { PackageAddons } from '../package-addons';
import { PackageFacts } from '../../../components/package-facts';
import { PackageDetailsForm } from '../package-details-form';

const BRANCH = ['branch'];
const LAYER_ORDER = ['main_agent', 'agent', 'pos'];
type Tab = 'overview' | 'details' | 'addons' | 'run' | 'prices' | 'renewals' | 'switches' | 'numbers' | 'offers';
type ShelfPackage = Shelf['companies'][number]['providers'][number]['packages'][number];
const EMPTY_PRICES: Record<PriceKey, string> = {
  branchCost: '',
  mainPrice: '',
  agentPrice: '',
  posPrice: '',
  subscriberPrice: '',
  renewalBranchCost: '',
  renewalMainPrice: '',
  renewalAgentPrice: '',
  renewalPosPrice: '',
  renewalSubscriberPrice: '',
};

type Seeded = { prices: typeof EMPTY_PRICES; esimPrice: string; renewals: string[]; switches: string[] };

// The form value after a reload: the server's when the user left the field as it was last loaded, else their draft.
function follow<T>(current: T, seeded: T | undefined, next: T): T {
  if (seeded === undefined) return next;
  return JSON.stringify(current) === JSON.stringify(seeded) ? next : current;
}

// Every line on the package, across all cursor pages: the operations tab selects among all of them.
async function packageLines(packageCode: string): Promise<Fetched<LineRow[]>> {
  const rows: LineRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LINE_PAGES; page += 1) {
    const result = await api.officeLines({ packageCode, cursor });
    if (!result.ok) return result;
    rows.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (!cursor) break;
  }
  return { ok: true, data: rows };
}

const MAX_LINE_PAGES = 100;

export function PackageSheetScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string; packageCode: string }>();
  // The price chain opens first, as in the design.
  const [tab, setTab] = useState<Tab>('prices');
  const [prices, setPrices] = useState(EMPTY_PRICES);
  const [esimPrice, setEsimPrice] = useState('');
  const [renewals, setRenewals] = useState<string[]>([]);
  const [switches, setSwitches] = useState<string[]>([]);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [loginName, setLoginName] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerRenewal, setOfferRenewal] = useState('');
  // The scope picked in the prices tab, and the open table: one scope (a login, or `all`) at a time.
  const [priceScope, setPriceScope] = useState('all');
  const [pricing, setPricing] = useState<{ scope: string } | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const allowed = useRequireLayer(BRANCH);
  // The owner and staff with the edit grant change the extra operations; other branch staff read them.
  const { me } = useOffice();
  const canEditAddons = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')));
  // Five reads, cached apart (ADR 0001). The sheet, its numbers and its custom prices belong to this package and are
  // asked again after an action here; the companies shelf and the accounts are shared with other screens and stay.
  const code = params.packageCode;
  const sheetRead = useApiQuery(packageKeys.sheet(code), () => api.packageSheet(code), { enabled: allowed });
  const linesRead = useApiQuery(packageKeys.lines(code), () => packageLines(code), { enabled: allowed });
  const pricesRead = useApiQuery(packageKeys.customPrices(code), () => api.customPrices(code), { enabled: allowed });
  const shelfRead = useApiQuery(sharedKeys.companies, () => api.officeCompanies(), { enabled: allowed });
  const usersRead = useApiQuery(sharedKeys.users, everyAccount, { enabled: allowed });
  const cardData = useMemo(
    () =>
      sheetRead.data && shelfRead.data && linesRead.data
        ? {
            sheet: sheetRead.data,
            shelf: shelfRead.data,
            lines: linesRead.data.filter((line) => line.packageCode === code),
            users: (usersRead.data?.users ?? []).filter((row) => row.layer !== 'branch'),
            customPrices: pricesRead.data ?? [],
          }
        : null,
    [sheetRead.data, shelfRead.data, linesRead.data, usersRead.data, pricesRead.data, code],
  );
  const client = useQueryClient();
  const card = {
    loaded: sheetRead.loaded && linesRead.loaded && shelfRead.loaded && pricesRead.loaded && usersRead.loaded,
    // The custom prices and the accounts are helpers: without them the sheet still shows.
    error: sheetRead.error || shelfRead.error || linesRead.error,
    data: cardData,
    reload: () => client.invalidateQueries({ queryKey: packageKeys.all(code) }),
  };
  const sheet = card.data?.sheet ?? null;
  usePageTitle(sheet ? `${sheet.companyName} · ${sheet.name}` : '');
  // The package lives under its company, the catalog's root (spec 2026-11-09-admin-review, 4).
  useCrumbs({
    [`/companies/${encodeURIComponent(params.code)}`]: sheet?.companyName,
    [`/companies/${encodeURIComponent(params.code)}/packages`]: t.packagesTab,
    [`/companies/${encodeURIComponent(params.code)}/packages/${encodeURIComponent(code)}`]: sheet?.name,
  });
  const users = card.data?.users ?? [];
  // The layer column the picked account would pay without a custom price; the pos column until one is picked.
  const pickedLayer = users.find((row) => row.loginName === loginName)?.layer ?? 'pos';
  const layerDefault = (kind: 'subscription' | 'renewal') => {
    if (!sheet) return 0;
    if (pickedLayer === 'main_agent') return kind === 'subscription' ? sheet.mainPrice : sheet.renewalMainPrice;
    if (pickedLayer === 'agent') return kind === 'subscription' ? sheet.agentPrice : sheet.renewalAgentPrice;
    return kind === 'subscription' ? sheet.posPrice : sheet.renewalPosPrice;
  };
  const lines = card.data?.lines ?? [];
  const customPrices = card.data?.customPrices ?? [];
  const company = card.data?.shelf.companies.find((item) => item.code === sheet?.companyCode);
  const provider = company?.providers.find((item) => item.code === sheet?.providerCode);
  const targetPackages = (provider?.packages ?? []).filter((item) => item.code !== sheet?.code);
  const { run, busy } = useAction({ setError, setNote, onDone: card.reload });

  // Every action reloads the sheet. A field (or list) the user has not edited since the last load follows the server;
  // one they typed in keeps their draft, so saving in one tab never wipes unsaved fields in another.
  const seeded = useRef<Seeded | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const next: Seeded = {
      prices: {
        branchCost: shekelField(sheet.branchCost),
        mainPrice: shekelField(sheet.mainPrice),
        agentPrice: shekelField(sheet.agentPrice),
        posPrice: shekelField(sheet.posPrice),
        subscriberPrice: shekelField(sheet.subscriberPrice),
        renewalBranchCost: shekelField(sheet.renewalBranchCost),
        renewalMainPrice: shekelField(sheet.renewalMainPrice),
        renewalAgentPrice: shekelField(sheet.renewalAgentPrice),
        renewalPosPrice: shekelField(sheet.renewalPosPrice),
        renewalSubscriberPrice: shekelField(sheet.renewalSubscriberPrice),
      },
      esimPrice: sheet.esimPrice === null ? '' : shekelField(sheet.esimPrice),
      renewals: sheet.renewals,
      switches: sheet.switches,
    };
    const before = seeded.current;
    seeded.current = next;
    setPrices((current) => {
      const merged = { ...current };
      for (const key of Object.keys(next.prices) as PriceKey[]) merged[key] = follow(current[key], before?.prices[key], next.prices[key]);
      return merged;
    });
    setEsimPrice((current) => follow(current, before?.esimPrice, next.esimPrice));
    setRenewals((current) => follow(current, before?.renewals, next.renewals));
    setSwitches((current) => follow(current, before?.switches, next.switches));
  }, [sheet]);

  async function saveMode(action: string, mode: string) {
    if (!sheet) return;
    await run(() => api.setPackageMode(sheet.code, { action, mode }));
  }

  async function saveChain() {
    if (!sheet) return;
    const keys = Object.keys(prices) as PriceKey[];
    const body: Partial<Record<PriceKey, number>> = {};
    for (const key of keys) {
      const price = parseShekel(prices[key]);
      if (price === null) {
        setError(apiText('بيانات غير صالحة'));
        setNote('');
        return;
      }
      body[key] = price;
    }
    const esim = esimPrice.trim() ? parseShekel(esimPrice) : null;
    if (esimPrice.trim() && esim === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setChain(sheet.code, { ...body, esimPrice: esim }), { note: t.save });
  }

  const esimSourceName = sheet
    ? sheet.esimPriceSource === 'package' ? t.esimSourcePackage : sheet.esimPriceSource === 'provider' ? t.esimSourceProvider : t.esimSourceCompany
    : '';

  async function saveTargets(kind: 'renewals' | 'switches') {
    if (!sheet) return;
    const targets = kind === 'renewals' ? renewals : switches;
    await run(
      () => kind === 'renewals' ? api.setPackageRenewals(sheet.code, targets) : api.setPackageSwitches(sheet.code, targets),
      { note: t.save },
    );
  }

  function toggleTarget(kind: 'renewals' | 'switches', code: string, checked: boolean) {
    const set = kind === 'renewals' ? setRenewals : setSwitches;
    set((current) => checked ? [...current, code] : current.filter((item) => item !== code));
  }

  async function saveOffer() {
    if (!sheet || !loginName) return;
    const price = offerPrice.trim() === '' ? undefined : parseShekel(offerPrice);
    const renewalPrice = offerRenewal.trim() === '' ? undefined : parseShekel(offerRenewal);
    if (price === null || renewalPrice === null || (price === undefined && renewalPrice === undefined)) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setCustomPrice(sheet.code, loginName, { price, renewalPrice }), {
      note: t.saved,
      then: () => {
        setOfferPrice('');
        setOfferRenewal('');
      },
    });
  }

  async function saveCustomPrice(offer: CustomPriceRow, field: 'price' | 'renewalPrice', text: string) {
    if (!sheet) return;
    const value = text === '' ? null : parseShekel(text);
    if (value === null && text !== '') {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    const next = { price: offer.price, renewalPrice: offer.renewalPrice, [field]: value };
    if (next.price === null && next.renewalPrice === null) {
      await run(() => api.clearCustomPrice(sheet.code, offer.loginName), { note: t.saved });
      return;
    }
    await run(() => api.setCustomPrice(sheet.code, offer.loginName, { [field]: value }), { note: t.saved });
  }

  const offerColumns: Column<CustomPriceRow>[] = [
    { key: 'account', header: t.accountName, render: (offer) => <AccountName login={offer.loginName} name={offer.nickname} /> },
    { key: 'layer', header: t.layer, fit: true, render: (offer) => layerName(t, offer.layer) },
    { key: 'parent', header: t.parent, fit: true, render: (offer) => <bdi dir="ltr">{offer.parentLoginName ?? '—'}</bdi> },
    {
      key: 'price',
      header: t.subscriptionPrice,
      num: true,
      sortValue: (offer) => offer.price ?? offer.defaultPrice,
      render: (offer) => (
        <span className="price-pair">
          <Money value={offer.defaultPrice} muted />
          <PriceField
            label={`${accountLabel(offer.loginName, offer.nickname)} ${t.subscriptionShort}`}
            value={offer.price}
            placeholder={offer.defaultPrice}
            onSave={(text) => void saveCustomPrice(offer, 'price', text)}
          />
        </span>
      ),
    },
    {
      key: 'renewal',
      header: t.renewalPrice,
      num: true,
      sortValue: (offer) => offer.renewalPrice ?? offer.defaultRenewalPrice,
      render: (offer) => (
        <span className="price-pair">
          <Money value={offer.defaultRenewalPrice} muted />
          <PriceField
            label={`${accountLabel(offer.loginName, offer.nickname)} ${t.renewalShort}`}
            value={offer.renewalPrice}
            placeholder={offer.defaultRenewalPrice}
            onSave={(text) => void saveCustomPrice(offer, 'renewalPrice', text)}
          />
        </span>
      ),
    },
    {
      key: 'diff',
      header: t.difference,
      num: true,
      // By the subscription difference; a row without its own subscription price falls back to the renewal one.
      sortValue: (offer) => (offer.price !== null ? offer.price - offer.defaultPrice : offer.renewalPrice !== null ? offer.renewalPrice - offer.defaultRenewalPrice : null),
      render: (offer) => (
        <span className="price-pair">
          {offer.price === null ? <span className="hint">—</span> : <Money value={offer.price - offer.defaultPrice} signed />}
          {offer.renewalPrice === null ? <span className="hint">—</span> : <Money value={offer.renewalPrice - offer.defaultRenewalPrice} signed />}
        </span>
      ),
    },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (offer) => (
        <RowMenu
          label={`${t.rowActions} ${accountLabel(offer.loginName, offer.nickname)}`}
          items={[
            {
              label: t.resetDefault,
              icon: 'undo',
              onClick: () => void run(() => api.clearCustomPrice(sheet?.code ?? '', offer.loginName), { note: t.saved }),
            },
            { label: t.linePricesMenu, icon: 'receipt', onClick: () => setPricing({ scope: offer.loginName }) },
          ]}
        />
      ),
    },
  ];
  const sortedCustomPrices = [...customPrices].sort(
    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer) || a.loginName.localeCompare(b.loginName),
  );
  const allLinesSelected = lines.length > 0 && lines.every((line) => selectedLines.includes(line.id));
  const lineColumns: Column<LineRow>[] = [
    {
      key: 'select',
      fit: true,
      header: (
        <label className="check">
          <input
            type="checkbox"
            aria-label={t.selectAll}
            checked={allLinesSelected}
            onChange={(event) => setSelectedLines(event.target.checked ? lines.map((line) => line.id) : [])}
          />
        </label>
      ),
      render: (line) => (
        <label className="check">
          <input
            type="checkbox"
            aria-label={`${t.selectLine} ${line.msisdn}`}
            checked={selectedLines.includes(line.id)}
            onChange={(event) => setSelectedLines((current) => (
              event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id)
            ))}
          />
        </label>
      ),
    },
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <bdi dir="ltr">{line.msisdn}</bdi> },
    {
      key: 'status',
      header: t.status,
      render: (line) => (
        <Badge variant={lineTone(line.status)} dot>{lineStatus(t, line.status)}</Badge>
      ),
    },
  ];
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t.overviewTab },
    { key: 'prices', label: t.priceChainTab },
    { key: 'details', label: t.detailsTab },
    { key: 'addons', label: t.lineAddons },
    { key: 'run', label: t.packageActions },
    { key: 'renewals', label: t.renewalsTab },
    { key: 'switches', label: t.switchesTab },
    { key: 'numbers', label: t.numbersTab },
    { key: 'offers', label: t.offersTab },
  ];
  function targetList(kind: 'renewals' | 'switches', packages: ShelfPackage[]) {
    const selected = kind === 'renewals' ? renewals : switches;
    return (
      <div className="pane-body target-list">
        {packages.length === 0 ? <p className="empty">{t.noTargetPackages}</p> : packages.map((pkg) => (
          <label className="check" key={pkg.code}>
            <input
              type="checkbox"
              checked={selected.includes(pkg.code)}
              onChange={(event) => toggleTarget(kind, pkg.code, event.target.checked)}
            />
            <span>{pkg.name} · {pkg.months} {t.months}</span>
            <Badge variant={onOffTone(pkg.forSale)} dot>{pkg.forSale ? t.forSale : t.notForSale}</Badge>
          </label>
        ))}
        <Button type="button" onClick={() => void saveTargets(kind)}>{t.save}</Button>
      </div>
    );
  }

  return (
    <Desk
      title={sheet ? (
        // Graphite: the company's cut-corner mark, the package's name; its provider and live numbers under it; whether
        // it is for sale beside it.
        <span className="ticket-title">
          <span className="co-mark big" style={{ background: markColor(sheet.companyName || '?') }} aria-hidden="true">{markOf(sheet.companyName || '?')}</span>
          <span>{`${sheet.companyName} · ${sheet.name}`}</span>
        </span>
      ) : ''}
      action={sheet ? (
        <div className="page-actions sheet-head-actions">
          {/* On/off is switched from the company's packages list (spec 2026-11-11-ui-consistency-pass, D2). */}
          <Badge variant={onOffTone(sheet.enabled)} dot>{sheet.enabled ? t.lineActive : t.stopped}</Badge>
          <Badge variant={onOffTone(sheet.forSale)} dot>{sheet.forSale ? t.forSale : t.notForSale}</Badge>
        </div>
      ) : undefined}
      lede={sheet ? [`${t.provider} ${sheet.providerName}`, `${sheet.activeLines} ${t.activeLines}`].join(' · ') : ''}
      error={error || card.error}
      note={note}
    >
      <div className="stack">
        {card.loaded && sheet ? <Tabs items={tabs} value={tab} onChange={setTab} /> : null}
        <section className="pane package-sheet">
          {!card.loaded || !sheet ? <TableSkeleton rows={6} columns={2} /> : (
            <>
              {tab === 'overview' && (
                <div className="pane-body">
                  <div className="sheet-stats">
                    <div>
                      <span>{t.linesTotal}</span>
                      <strong className="num">{sheet.lines}</strong>
                    </div>
                    <div>
                      <span>{t.activeLines}</span>
                      <strong className="num">{sheet.activeLines}</strong>
                    </div>
                  </div>
                  <div className="sheet-meta">
                    <div>
                      <span>{t.provider}</span>
                      <strong>{sheet.providerName}</strong>
                    </div>
                  </div>
                  <Badge variant={onOffTone(sheet.forSale)} dot>{sheet.forSale ? t.forSale : t.notForSale}</Badge>
                  <PackageFacts facts={sheet} />
                </div>
              )}
              {tab === 'details' && (
                <PackageDetailsForm key={sheet.code} sheet={sheet} run={run} busy={busy} onInvalid={() => { setError(apiText('بيانات غير صالحة')); setNote(''); }} />
              )}
              {tab === 'addons' && (
                <PackageAddons code={sheet.code} canEdit={canEditAddons} setError={setError} setNote={setNote} />
              )}
              {tab === 'run' && (
                <div className="pane-body">
                  {/* The modes come from the provider and follow it, except the ones set here (ADR 0009). */}
                  <InheritedModes
                    modes={sheet.modes}
                    inherited={sheet.inheritedModes ?? []}
                    disabled={busy}
                    onChange={(action, mode) => void saveMode(action, mode)}
                  />
                </div>
              )}
              {tab === 'prices' && (
                <ChainBoard prices={prices} onChange={(key, value) => setPrices((current) => ({ ...current, [key]: value }))}>
                  {/* «حفظ» saves the chain and the eSIM price beside it; re-pricing the live numbers has its own button. */}
                  <Button type="button" onClick={() => void saveChain()}>{t.save}</Button>
                  <div className="account-fund">
                    <h3>{t.esimPrice}</h3>
                    <label>
                      {t.esimPrice}
                      <input
                        className="num"
                        inputMode="decimal"
                        value={esimPrice}
                        placeholder={t.useInheritedPrice}
                        onChange={(event) => setEsimPrice(event.target.value)}
                      />
                      <span className="hint">
                        {t.esimPriceFrom.replace('{price}', formatShekel(sheet.esimPriceEffective)).replace('{source}', esimSourceName)}
                      </span>
                    </label>
                  </div>
                  <div className="account-fund">
                    <h3>{t.repriceTitle}</h3>
                    <label>
                      {t.linePricesScope}
                      <NameField
                        value={priceScope === 'all' ? '' : priceScope}
                        allLabel={t.linePricesAll}
                        onChange={(next) => setPriceScope(next || 'all')}
                        options={users.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), hint: layerName(t, row.layer), keys: [row.loginName] }))}
                      />
                    </label>
                    <div>
                      <Button type="button" variant="secondary" onClick={() => setPricing({ scope: priceScope })}>{t.linePricesOpen}</Button>
                    </div>
                  </div>
                </ChainBoard>
              )}
              {tab === 'renewals' && targetList('renewals', targetPackages)}
              {tab === 'switches' && targetList('switches', targetPackages)}
              {tab === 'numbers' && (
                <div className="sheet">
                  <DataTable
                    bare
                    columns={lineColumns}
                    rows={lines}
                    rowKey={(line) => line.id}
                    empty={t.noLines}
                    keepHead
                  />
                </div>
              )}
              {tab === 'offers' && (
                <div className="pane-body">
                  <div className="account-fund custom-price-add">
                    <label>
                      {t.accountName}
                      <NameField
                        value={loginName}
                        onChange={setLoginName}
                        options={users.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), hint: layerName(t, row.layer), keys: [row.loginName] }))}
                      />
                    </label>
                    <label>
                      {t.subscriptionPrice}
                      <input inputMode="decimal" value={offerPrice} placeholder={shekelField(layerDefault('subscription'))} onChange={(event) => setOfferPrice(event.target.value)} />
                    </label>
                    <label>
                      {t.renewalPrice}
                      <input inputMode="decimal" value={offerRenewal} placeholder={shekelField(layerDefault('renewal'))} onChange={(event) => setOfferRenewal(event.target.value)} />
                    </label>
                    <Button type="button" disabled={!loginName || (offerPrice === '' && offerRenewal === '')} onClick={() => void saveOffer()}>{t.save}</Button>
                  </div>
                  <p className="hint">{t.customPricesHint}</p>
                  <div className="sheet">
                    <DataTable bare columns={offerColumns} rows={sortedCustomPrices} rowKey={(offer) => offer.loginName} empty={t.noOffers} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <LinePricesDialog
        open={pricing !== null && sheet !== null}
        code={sheet?.code ?? ''}
        packageName={sheet?.name ?? ''}
        scope={pricing?.scope ?? ''}
        onClose={() => setPricing(null)}
        onSaved={(lines) => setNote(t.linePricesSaved.replace('{n}', String(lines)))}
      />
    </Desk>
  );
}
