'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, layerName, lineStatus } from '../../../components/desk';
import { LinePricesDialog } from '../../../components/line-prices-dialog';
import { usePageTitle } from '../../../lib/page-title';
import { TableSkeleton } from '../../../components/loading';
import { PriceField } from '../../../components/price-field';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { TableSheet } from '../../../components/ui/table';
import { api, type CustomPriceRow, type LineRow, type Shelf } from '../../../lib/api';
import { everyAccount } from '../../../lib/directory';
import { parseShekel, shekelField } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { type Fetched } from '../../../lib/fetched';
import { useApiQuery } from '../../../lib/use-api-query';
import { packageKeys, sharedKeys } from '../../../lib/query';
import { useQueryClient } from '@tanstack/react-query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { useDesk } from '../../../lib/desk-session';
import { lineTone, onOffTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';
import { NameField } from '../../../components/name-field';
import { InheritedModes } from '../inherited-modes';
import { ChainBoard, type PriceKey } from '../chain-board';
import { useCrumbs } from '../../../lib/crumbs';
import { Tabs } from '../../../components/tabs';
import { PackageAddons } from '../package-addons';
import { PackageDurations } from '../package-durations';
import { PackageEsim } from '../package-esim';
import { PackageFacts } from '../../../components/package-facts';
import { PackageDetailsForm } from '../package-details-form';
import { CompanyMark } from '../../../components/company-mark';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { cn } from '../../../lib/cn';
import { paneHintClass } from '../sim-fields';

const BRANCH = ['branch'];
const LAYER_ORDER = ['main_agent', 'agent', 'pos'];
type Tab = 'overview' | 'details' | 'addons' | 'run' | 'prices' | 'durations' | 'renewals' | 'switches' | 'numbers' | 'offers';
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

type Seeded = { prices: typeof EMPTY_PRICES; renewals: string[]; switches: string[] };

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
    const result = await api.lines({ packageCode, cursor });
    if (!result.ok) return result;
    rows.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (!cursor) break;
  }
  return { ok: true, data: rows };
}

const MAX_LINE_PAGES = 100;

/*
 * The look (Tailwind migration T4.4, ADR 0022), ported from desk/packages.css, frame.css, pane.css, components.css,
 * table.css and graphite.css in their cascade order:
 * - the title: the company's cut-corner mark (`CompanyMark` lg) and the package's name in one wrapping row 12px apart;
 *   the states beside it in a row 10px apart;
 * - the page column (`COLUMN`): a flex column 12px apart that keeps its content's height; it keeps the `stack` class
 *   as the handle the desk column, the canvas and `Pane` size by;
 * - «نظرة عامة»: the two figures side by side 12px apart (one column under 721px), each a grid 4px apart, 14px inside,
 *   8px corners on `--rd-surface-2`, its name 12px bold `--rd-muted` and its figure 1.5rem bold (800 until T6.3, ADR 0021 D7), tabular, 1.1
 *   high; the facts as rows at least 44px high over a 1px `--rd-line-soft` rule, 12px apart, the name 13px bold
 *   `--rd-muted` and the value 14px bold ink; the sale state at the start;
 * - the cards under the price chain (`FUND`): a one-column grid 10px apart at the foot, its heading 0.95rem bold ink,
 *   its fields pane labels in bold; the re-pricing card, the board's last, shares the board's row with the eSIM price
 *   card (graphite.css's `grid-column: auto` overrode packages.css's `1 / -1`) and lays out its field and its button
 *   side by side from 721px with its heading across both;
 * - «التجديد» / «التبديل»: each package a pane label laid out as a row (the box, its name, its sale state) at least
 *   44px high over a 1px `--rd-line-soft` rule, 10px apart; the empty line 13px `--rd-muted`, 14px inside;
 * - the numbers' boxes: a pane label at least 36px high (44px under 721px) around a `Checkbox`;
 * - «تخصيص سعر»: the account, the two prices and the save in one row (12rem / 8rem / 8rem / the button), under 1100px
 *   two columns with the account and the save across; a price cell's default figure (12px) beside its field, 10px
 *   apart at the inline end; on a phone's card the cell takes the card's whole row and wraps from the start; an empty
 *   difference is a table note (12px `--rd-muted` 500).
 */
const COLUMN = 'stack flex min-h-auto min-w-0 max-w-full flex-none flex-col gap-3 overflow-visible *:min-w-0';
const STAT = 'grid min-w-0 gap-1 rounded-card bg-surface-2 p-3.5';
const STAT_NAME = 'text-sm font-bold text-muted';
const STAT_VALUE = 'text-5xl leading-1-1 font-bold tabular-nums';
const FUND = 'grid min-w-0 grid-cols-1 items-end gap-2.5';
const FUND_TITLE = 'm-0 text-lg font-bold text-ink';
const FUND_LABEL = 'min-w-0 font-bold';
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center max-touch:min-h-11';
/** A phone's card (a table with `data-cards` whose cells carry their names): graphite.css's price editors rules. */
const IN_CARD_ROW = 'max-sm:[[data-cards]:has(td[data-label])_&]:col-span-full';
const PRICE_PAIR = cn(
  'inline-flex items-center justify-end gap-2.5',
  'max-sm:[[data-cards]:has(td[data-label])_&]:flex-wrap max-sm:[[data-cards]:has(td[data-label])_&]:justify-start',
);
/** The default figure beside a price field is 12px (Money reads `.price-pair` for that in the line prices dialog). */
const PRICE_PAIR_DEFAULT = cn(PRICE_PAIR, '[&>[data-slot=money]]:text-sm');
const TABLE_NOTE = 'm-0 text-sm font-medium text-muted';

export function PackageSheetScreen() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string; packageCode: string }>();
  // The price chain opens first, as in the design.
  const [tab, setTab] = useState<Tab>('prices');
  const [prices, setPrices] = useState(EMPTY_PRICES);
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
  const { me } = useDesk();
  const canEditAddons = Boolean(me && (me.isBranchOwner || me.grants.includes('edit')));
  // Five reads, cached apart (ADR 0001). The sheet, its numbers and its custom prices belong to this package and are
  // asked again after an action here; the companies shelf and the accounts are shared with other screens and stay.
  const code = params.packageCode;
  const sheetRead = useApiQuery(packageKeys.sheet(code), () => api.packageSheet(code), { enabled: allowed });
  const linesRead = useApiQuery(packageKeys.lines(code), () => packageLines(code), { enabled: allowed });
  const pricesRead = useApiQuery(packageKeys.customPrices(code), () => api.customPrices(code), { enabled: allowed });
  const shelfRead = useApiQuery(sharedKeys.companies, () => api.companies(), { enabled: allowed });
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
    await run(() => api.setChain(sheet.code, body), { note: t.save });
  }

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
      cell: IN_CARD_ROW,
      render: (offer) => (
        <span className={PRICE_PAIR_DEFAULT} data-testid="price-pair">
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
      cell: IN_CARD_ROW,
      render: (offer) => (
        <span className={PRICE_PAIR_DEFAULT} data-testid="price-pair">
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
      cell: IN_CARD_ROW,
      render: (offer) => (
        <span className={PRICE_PAIR} data-testid="price-pair">
          {offer.price === null ? <span className={TABLE_NOTE}>—</span> : <Money value={offer.price - offer.defaultPrice} signed />}
          {offer.renewalPrice === null ? <span className={TABLE_NOTE}>—</span> : <Money value={offer.renewalPrice - offer.defaultRenewalPrice} signed />}
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
        <Label tone="pane" className={CHECK_ROW}>
          <Checkbox
            aria-label={t.selectAll}
            checked={allLinesSelected}
            onCheckedChange={(next) => setSelectedLines(next === true ? lines.map((line) => line.id) : [])}
          />
        </Label>
      ),
      render: (line) => (
        <Label tone="pane" className={CHECK_ROW}>
          <Checkbox
            aria-label={`${t.selectLine} ${line.msisdn}`}
            checked={selectedLines.includes(line.id)}
            onCheckedChange={(next) => setSelectedLines((current) => (
              next === true ? [...current, line.id] : current.filter((id) => id !== line.id)
            ))}
          />
        </Label>
      ),
    },
    { key: 'number', header: t.number, kind: 'msisdn', render: (line) => <bdi dir="ltr">{line.msisdn}</bdi> },
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
    { key: 'durations', label: t.durationsTab },
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
      <div className="pane-body">
        {packages.length === 0 ? <p className="m-0 block p-3.5 text-md text-muted">{t.noTargetPackages}</p> : packages.map((pkg) => (
          <Label
            tone="pane"
            className="m-0 grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line-soft"
            key={pkg.code}
          >
            <Checkbox
              checked={selected.includes(pkg.code)}
              onCheckedChange={(next) => toggleTarget(kind, pkg.code, next === true)}
            />
            <span>{pkg.name} · {pkg.months} {t.months}</span>
            <Badge variant={onOffTone(pkg.forSale)} dot>{pkg.forSale ? t.forSale : t.notForSale}</Badge>
          </Label>
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
        <span className="inline-flex flex-wrap items-center gap-3">
          <CompanyMark name={sheet.companyName || '?'} size="lg" />
          <span>{`${sheet.companyName} · ${sheet.name}`}</span>
        </span>
      ) : ''}
      action={sheet ? (
        <div className="inline-flex flex-wrap items-center gap-2.5">
          {/* On/off is switched from the company's packages list (spec 2026-11-11-ui-consistency-pass, D2). */}
          <Badge variant={onOffTone(sheet.enabled)} dot>{sheet.enabled ? t.lineActive : t.stopped}</Badge>
          <Badge variant={onOffTone(sheet.forSale)} dot>{sheet.forSale ? t.forSale : t.notForSale}</Badge>
        </div>
      ) : undefined}
      lede={sheet ? [`${t.provider} ${sheet.providerName}`, `${sheet.activeLines} ${t.activeLines}`].join(' · ') : ''}
      error={error || card.error}
      note={note}
    >
      <div className={COLUMN}>
        {card.loaded && sheet ? <Tabs items={tabs} value={tab} onChange={setTab} /> : null}
        <Pane>
          {!card.loaded || !sheet ? <TableSkeleton rows={6} columns={2} /> : (
            <>
              {tab === 'overview' && (
                <div className="pane-body">
                  <div className="grid grid-cols-2 gap-3 max-touch:grid-cols-1">
                    <div className={STAT}>
                      <span className={STAT_NAME}>{t.linesTotal}</span>
                      <strong className={STAT_VALUE}>{sheet.lines}</strong>
                    </div>
                    <div className={STAT}>
                      <span className={STAT_NAME}>{t.activeLines}</span>
                      <strong className={STAT_VALUE}>{sheet.activeLines}</strong>
                    </div>
                  </div>
                  <div className="grid">
                    <div className="flex min-h-11 items-center justify-start gap-3 border-b border-line-soft">
                      <span className="text-md font-bold text-muted">{t.provider}</span>
                      <strong className="text-base font-bold text-ink">{sheet.providerName}</strong>
                    </div>
                  </div>
                  <Badge className="justify-self-start" variant={onOffTone(sheet.forSale)} dot>{sheet.forSale ? t.forSale : t.notForSale}</Badge>
                  <PackageFacts facts={sheet} />
                  <PackageEsim
                    key={`${sheet.code}:${sheet.esimPrice ?? ''}`}
                    sheet={sheet}
                    canEdit={canEditAddons}
                    busy={busy}
                    run={run}
                    onInvalid={() => { setError(apiText('بيانات غير صالحة')); setNote(''); }}
                  />
                </div>
              )}
              {tab === 'details' && (
                <PackageDetailsForm key={sheet.code} sheet={sheet} run={run} busy={busy} onInvalid={() => { setError(apiText('بيانات غير صالحة')); setNote(''); }} />
              )}
              {tab === 'durations' && (
                <PackageDurations
                  code={sheet.code}
                  months={sheet.months}
                  durations={sheet.durations}
                  canEdit={canEditAddons}
                  busy={busy}
                  run={run}
                  onInvalid={() => { setError(apiText('بيانات غير صالحة')); setNote(''); }}
                />
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
                  {/* «حفظ» saves the chain; the eSIM price is on the start tab, and re-pricing the live numbers has its own button. */}
                  <Button type="button" onClick={() => void saveChain()}>{t.save}</Button>
                  {/* The board's last card: its field and its button side by side from 721px, the heading across. */}
                  <div className={cn(FUND, 'min-[721px]:grid-cols-title-end')} data-testid="reprice">
                    <h3 className={cn(FUND_TITLE, 'col-span-full')}>{t.repriceTitle}</h3>
                    <Label tone="pane" className={FUND_LABEL}>
                      {t.linePricesScope}
                      <NameField
                        value={priceScope === 'all' ? '' : priceScope}
                        allLabel={t.linePricesAll}
                        onChange={(next) => setPriceScope(next || 'all')}
                        options={users.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), hint: layerName(t, row.layer), keys: [row.loginName] }))}
                      />
                    </Label>
                    <div>
                      <Button type="button" variant="secondary" onClick={() => setPricing({ scope: priceScope })}>{t.linePricesOpen}</Button>
                    </div>
                  </div>
                </ChainBoard>
              )}
              {tab === 'renewals' && targetList('renewals', targetPackages)}
              {tab === 'switches' && targetList('switches', targetPackages)}
              {tab === 'numbers' && (
                <TableSheet>
                  <DataTable
                    bare
                    columns={lineColumns}
                    rows={lines}
                    rowKey={(line) => line.id}
                    empty={t.noLines}
                    keepHead
                  />
                </TableSheet>
              )}
              {tab === 'offers' && (
                <div className="pane-body">
                  <div
                    className={cn(
                      FUND,
                      'grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_auto]',
                      'max-xl:grid-cols-2 max-xl:[&>[data-slot=button]]:col-span-full max-xl:[&>[data-slot=label]:first-child]:col-span-full',
                    )}
                  >
                    <Label tone="pane" className={FUND_LABEL}>
                      {t.accountName}
                      <NameField
                        value={loginName}
                        onChange={setLoginName}
                        options={users.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), hint: layerName(t, row.layer), keys: [row.loginName] }))}
                      />
                    </Label>
                    <Label tone="pane" className={FUND_LABEL}>
                      {t.subscriptionPrice}
                      <Input surface="surface" className="text-md" inputMode="decimal" value={offerPrice} placeholder={shekelField(layerDefault('subscription'))} onChange={(event) => setOfferPrice(event.target.value)} />
                    </Label>
                    <Label tone="pane" className={FUND_LABEL}>
                      {t.renewalPrice}
                      <Input surface="surface" className="text-md" inputMode="decimal" value={offerRenewal} placeholder={shekelField(layerDefault('renewal'))} onChange={(event) => setOfferRenewal(event.target.value)} />
                    </Label>
                    <Button type="button" className="self-end px-3.5 text-sm leading-5 font-bold" disabled={!loginName || (offerPrice === '' && offerRenewal === '')} onClick={() => void saveOffer()}>{t.save}</Button>
                  </div>
                  <p className={paneHintClass}>{t.customPricesHint}</p>
                  <TableSheet>
                    <DataTable bare columns={offerColumns} rows={sortedCustomPrices} rowKey={(offer) => offer.loginName} empty={t.noOffers} />
                  </TableSheet>
                </div>
              )}
            </>
          )}
        </Pane>
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
