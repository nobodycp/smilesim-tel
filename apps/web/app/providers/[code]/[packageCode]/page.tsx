'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccountName, accountLabel } from '../../../../components/account-name';
import { DataTable, type Column } from '../../../../components/data-table';
import { Desk, Money, layerName, lineBadgeClass, lineStatus } from '../../../../components/desk';
import { LiveSwitch } from '../../../../components/live-switch';
import { TableSkeleton } from '../../../../components/loading';
import { RowMenu } from '../../../../components/row-menu';
import { Button } from '../../../../components/ui/button';
import { api, type CustomPriceRow, type LineRow, type Shelf } from '../../../../lib/api';
import { formatShekel, parseShekel, shekelField } from '../../../../lib/money';
import { usePrefs } from '../../../../lib/prefs';
import { useAction } from '../../../../lib/use-action';
import { useLoad } from '../../../../lib/use-load';
import { useRequireLayer } from '../../../../lib/use-require-layer';

const BRANCH = ['branch'];
const actions = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim', 'companySwitch'] as const;
type ModeAction = (typeof actions)[number];
type Tab = 'overview' | 'run' | 'prices' | 'renewals' | 'switches' | 'numbers' | 'offers';
type ShelfPackage = Shelf['companies'][number]['providers'][number]['packages'][number];
type PriceKey =
  | 'branchCost'
  | 'mainPrice'
  | 'agentPrice'
  | 'posPrice'
  | 'subscriberPrice'
  | 'renewalBranchCost'
  | 'renewalMainPrice'
  | 'renewalAgentPrice'
  | 'renewalPosPrice'
  | 'renewalSubscriberPrice';

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

export default function PackageSheetPage() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string; packageCode: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [prices, setPrices] = useState(EMPTY_PRICES);
  const [esimPrice, setEsimPrice] = useState('');
  const [renewals, setRenewals] = useState<string[]>([]);
  const [switches, setSwitches] = useState<string[]>([]);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [loginName, setLoginName] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [repriceWhich, setRepriceWhich] = useState('stay');
  const [repricePrice, setRepricePrice] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const allowed = useRequireLayer(BRANCH);
  const card = useLoad(
    async () => {
      const [found, accounts, shelf, lines, customPrices] = await Promise.all([
        api.packageSheet(params.packageCode),
        api.officeUsers(),
        api.officeCompanies(),
        api.officeLines({ packageCode: params.packageCode }),
        api.customPrices(params.packageCode),
      ]);
      if (!found.ok) return found;
      if (!shelf.ok) return shelf;
      if (!lines.ok) return lines;
      return {
        ok: true as const,
        data: {
          sheet: found.data,
          shelf: shelf.data,
          lines: lines.data.lines.filter((line) => line.packageCode === params.packageCode),
          users: accounts.ok ? accounts.data.users.filter((row) => row.layer !== 'branch') : [],
          customPrices: customPrices.ok ? customPrices.data : [],
        },
      };
    },
    [params.packageCode],
    { enabled: allowed },
  );
  const sheet = card.data?.sheet ?? null;
  const users = card.data?.users ?? [];
  const lines = card.data?.lines ?? [];
  const customPrices = card.data?.customPrices ?? [];
  const company = card.data?.shelf.companies.find((item) => item.code === sheet?.companyCode);
  const provider = company?.providers.find((item) => item.code === sheet?.providerCode);
  const targetPackages = (provider?.packages ?? []).filter((item) => item.code !== sheet?.code);
  const { run } = useAction({ setError, setNote, onDone: card.reload });
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

  // Every reload brings the saved prices back into the form.
  useEffect(() => {
    if (!sheet) return;
    setPrices({
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
    });
    setEsimPrice(sheet.esimPrice === null ? '' : shekelField(sheet.esimPrice));
    setRenewals(sheet.renewals);
    setSwitches(sheet.switches);
    setSelectedLines([]);
    setRepriceWhich((current) => (current === 'stay' || sheet.renewals.includes(current) ? current : 'stay'));
  }, [sheet]);

  async function saveMode(action: string, mode: string) {
    if (!sheet) return;
    await run(() => api.setPackageMode(sheet.code, { action, mode }));
  }

  async function saveEnabled(enabled: boolean) {
    if (!sheet) return;
    await run(() => api.setPackageMode(sheet.code, { enabled }));
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

  async function saveReprice() {
    if (!sheet || repricePrice === '') return;
    const price = parseShekel(repricePrice);
    if (price === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.repriceRenewal(sheet.code, repriceWhich, price), {
      note: t.save,
      then: () => setRepricePrice(''),
    });
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
    const price = parseShekel(offerPrice);
    if (price === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await run(() => api.setCustomPrice(sheet.code, loginName, { price }), { note: t.save, then: () => setOfferPrice('') });
  }

  const modeColumns: Column<ModeAction>[] = [
    { key: 'kind', header: t.kind, render: (action) => names[action] },
    {
      key: 'run',
      header: t.runTab,
      render: (action) => (
        <select className="mode-pick" aria-label={`${t.runTab} ${names[action]}`} value={sheet?.modes[action] ?? 'manual'} onChange={(event) => void saveMode(action, event.target.value)}>
          <option value="auto">{t.automatic}</option>
          <option value="manual">{t.manual}</option>
          <option value="off">{t.stopped}</option>
        </select>
      ),
    },
  ];
  const offerColumns: Column<CustomPriceRow>[] = [
    { key: 'account', header: t.accountName, render: (offer) => <AccountName login={offer.loginName} name={offer.nickname} /> },
    { key: 'layer', header: t.layer, render: (offer) => layerName(t, offer.layer) },
    { key: 'price', header: t.price, num: true, render: (offer) => <Money value={offer.price ?? offer.defaultPrice} /> },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (offer) => (
        <RowMenu
          label={`${t.rowActions} ${accountLabel(offer.loginName, offer.nickname)}`}
          items={[{
            label: t.deleteAccount,
            icon: 'trash',
            danger: true,
            onClick: () => void run(() => api.clearCustomPrice(sheet?.code ?? '', offer.loginName)),
          }]}
        />
      ),
    },
  ];
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
        <span className={lineBadgeClass(line.status)}>{lineStatus(t, line.status)}</span>
      ),
    },
  ];
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t.overviewTab },
    { key: 'run', label: t.packageActions },
    { key: 'prices', label: t.pricesTab },
    { key: 'renewals', label: t.renewalsTab },
    { key: 'switches', label: t.switchesTab },
    { key: 'numbers', label: t.numbersTab },
    { key: 'offers', label: t.offersTab },
  ];
  const priceGroups: { title: string; fields: [PriceKey, string][] }[] = [
    {
      title: t.subscriptionPrices,
      fields: [
        ['branchCost', t.branchCost],
        ['mainPrice', t.layerMain],
        ['agentPrice', t.layerAgent],
        ['posPrice', t.layerPos],
        ['subscriberPrice', t.subscriberPrice],
      ],
    },
    {
      title: t.renewalPrices,
      fields: [
        ['renewalBranchCost', t.branchCost],
        ['renewalMainPrice', t.layerMain],
        ['renewalAgentPrice', t.layerAgent],
        ['renewalPosPrice', t.layerPos],
        ['renewalSubscriberPrice', t.subscriberPrice],
      ],
    },
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
            <span className={pkg.forSale ? 'badge' : 'badge cancelled'}>{pkg.forSale ? t.forSale : t.notForSale}</span>
          </label>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => void saveTargets(kind)}>{t.save}</Button>
      </div>
    );
  }

  return (
    <Desk title={sheet ? `${sheet.companyName} · ${sheet.name}` : ''} lede="" error={error || card.error} note={note}>
      <div className="stack">
        <section className="pane package-sheet">
          {!card.loaded || !sheet ? <TableSkeleton rows={6} columns={2} /> : (
            <>
              <div className="steps" role="tablist">
                {tabs.map((item) => (
                  <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
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
                    <LiveSwitch label={t.packageLive} checked={sheet.enabled} onChange={(next) => void saveEnabled(next)}>
                      <span>{t.packageLive}</span>
                      <b>{sheet.enabled ? t.lineActive : t.stopped}</b>
                    </LiveSwitch>
                  </div>
                  <span className={sheet.forSale ? 'badge' : 'badge cancelled'}>{sheet.forSale ? t.forSale : t.notForSale}</span>
                </div>
              )}
              {tab === 'run' && (
                <div className="pane-body">
                  <DataTable bare columns={modeColumns} rows={[...actions]} rowKey={(action) => action} />
                </div>
              )}
              {tab === 'prices' && (
                <div className="pane-body price-board" aria-label={t.chainTab}>
                  {priceGroups.map((group) => (
                    <div className="account-fund" key={group.title}>
                      <h3>{group.title}</h3>
                      {group.fields.map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            className="num"
                            inputMode="numeric"
                            value={prices[key]}
                            onChange={(event) => setPrices((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                  ))}
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
                  <Button type="button" variant="secondary" size="sm" onClick={() => void saveChain()}>{t.save}</Button>
                  <div className="account-fund">
                    <h3>{t.repriceTitle}</h3>
                    <label>
                      {t.repriceWhich}
                      <select value={repriceWhich} onChange={(event) => setRepriceWhich(event.target.value)}>
                        <option value="stay">{t.repriceStay}</option>
                        {sheet.renewals.map((code) => {
                          const target = targetPackages.find((item) => item.code === code);
                          return (
                            <option key={code} value={code}>
                              {target ? `${target.name} · ${target.months} ${t.months}` : code}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      {t.layerPos}
                      <input
                        className="num"
                        inputMode="numeric"
                        value={repricePrice}
                        onChange={(event) => setRepricePrice(event.target.value)}
                      />
                    </label>
                    <button type="button" disabled={repricePrice === ''} onClick={() => void saveReprice()}>{t.save}</button>
                  </div>
                </div>
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
                  <div className="account-fund">
                    <label>
                      {t.accountName}
                      <select value={loginName} onChange={(event) => setLoginName(event.target.value)}>
                        <option value="">—</option>
                        {users.map((row) => (
                          <option key={row.loginName} value={row.loginName}>{accountLabel(row.loginName, row.nickname)} · {layerName(t, row.layer)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t.price}
                      <input inputMode="numeric" value={offerPrice} onChange={(event) => setOfferPrice(event.target.value)} />
                    </label>
                    <button type="button" disabled={!loginName || offerPrice === ''} onClick={() => void saveOffer()}>{t.save}</button>
                  </div>
                  <DataTable bare columns={offerColumns} rows={customPrices} rowKey={(offer) => offer.loginName} empty={t.noOffers} />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Desk>
  );
}
