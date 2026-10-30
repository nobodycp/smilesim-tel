'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, layerName } from '../../../../components/desk';
import { TableSkeleton } from '../../../../components/loading';
import { RowMenu } from '../../../../components/row-menu';
import { api, type PackageSheet, type UserRow } from '../../../../lib/api';
import { useDoor } from '../../../../lib/door-context';
import { useOffice } from '../../../../lib/office-session';
import { usePrefs } from '../../../../lib/prefs';

const actions = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim'] as const;
type Tab = 'run' | 'chain' | 'offers';

export default function PackageSheetPage() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string; packageCode: string }>();
  const [sheet, setSheet] = useState<PackageSheet | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tab, setTab] = useState<Tab>('run');
  const [prices, setPrices] = useState({ branchCost: '', mainPrice: '', agentPrice: '', posPrice: '', subscriberPrice: '' });
  const [loginName, setLoginName] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { me } = useOffice();
  const door = useDoor();
  const allowed = door.layer === 'branch' && me?.layer === 'branch';
  const names: Record<(typeof actions)[number], string> = {
    activate: t.actActivate,
    charge: t.actCharge,
    extend: t.extend,
    disconnect: t.actDisconnect,
    freeze: `${t.freeze} / ${t.unfreeze}`,
    switch: t.actSwitch,
    rename: t.updateNumber,
    sim: t.swapSim,
  };
  const modeName = (mode: string) => (mode === 'auto' ? t.automatic : mode === 'off' ? t.stopped : t.manual);

  const load = useCallback(async () => {
    const [card, accounts] = await Promise.all([api.packageSheet(params.packageCode), api.officeUsers()]);
    if (!card.ok) {
      setError(apiText(card.message));
      setLoaded(true);
      return;
    }
    setSheet(card.data);
    setPrices({
      branchCost: String(card.data.branchCost),
      mainPrice: String(card.data.mainPrice),
      agentPrice: String(card.data.agentPrice),
      posPrice: String(card.data.posPrice),
      subscriberPrice: String(card.data.subscriberPrice),
    });
    if (accounts.ok) setUsers(accounts.data.users.filter((row) => row.layer !== 'branch'));
    setLoaded(true);
  }, [apiText, params.packageCode]);

  useEffect(() => {
    if (door.layer !== 'branch' || (me && me.layer !== 'branch')) window.location.replace('/');
  }, [door.layer, me]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function saveMode(action: string, mode: string) {
    if (!sheet) return;
    const result = await api.setPackageMode(sheet.code, { action, mode });
    if (!result.ok) setError(apiText(result.message));
    else await load();
  }

  async function saveEnabled(enabled: boolean) {
    if (!sheet) return;
    const result = await api.setPackageMode(sheet.code, { enabled });
    if (!result.ok) setError(apiText(result.message));
    else await load();
  }

  async function saveChain() {
    if (!sheet) return;
    const body = {
      branchCost: Number(prices.branchCost),
      mainPrice: Number(prices.mainPrice),
      agentPrice: Number(prices.agentPrice),
      posPrice: Number(prices.posPrice),
      subscriberPrice: Number(prices.subscriberPrice),
    };
    const result = await api.setChain(sheet.code, body);
    if (!result.ok) setError(apiText(result.message));
    else {
      setNote(t.save);
      await load();
    }
  }

  async function saveOffer() {
    if (!sheet || !loginName) return;
    const result = await api.saveOffer(sheet.code, loginName, Number(offerPrice));
    if (!result.ok) setError(apiText(result.message));
    else {
      setOfferPrice('');
      setNote(t.save);
      await load();
    }
  }

  return (
    <Desk title={sheet ? `${sheet.companyName} · ${sheet.name}` : ''} lede={sheet?.providerName ?? ''} error={error} note={note}>
      <div className="stack">
        <Link className="back-link" href={sheet ? `/providers/${sheet.providerCode}` : '/providers'}>{t.navPlans}</Link>
        <section className="pane">
          {!loaded || !sheet ? <TableSkeleton rows={6} columns={2} /> : (
            <>
              <div className="steps" role="tablist">
                {(['run', 'chain', 'offers'] as const).map((item) => (
                  <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
                    {item === 'run' ? t.runTab : item === 'chain' ? t.chainTab : t.offersTab}
                  </button>
                ))}
              </div>
              {tab === 'run' && (
                <div className="pane-body">
                  <label className="switch-row">
                    {t.packageLive}
                    <select value={sheet.enabled ? 'on' : 'off'} onChange={(event) => void saveEnabled(event.target.value === 'on')}>
                      <option value="on">{t.lineActive}</option>
                      <option value="off">{t.stopped}</option>
                    </select>
                  </label>
                  <table className="data">
                    <thead>
                      <tr><th>{t.kind}</th><th>{t.runTab}</th></tr>
                    </thead>
                    <tbody>
                      {actions.map((action) => (
                        <tr key={action}>
                          <td>{names[action]}</td>
                          <td>
                            <select className="mode-pick" value={sheet.modes[action] ?? 'manual'} onChange={(event) => void saveMode(action, event.target.value)}>
                              <option value="auto">{t.automatic}</option>
                              <option value="manual">{t.manual}</option>
                              <option value="off">{t.stopped}</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tab === 'chain' && (
                <div className="pane-body account-fund">
                  {([
                    ['branchCost', t.branchCost],
                    ['mainPrice', t.layerMain],
                    ['agentPrice', t.layerAgent],
                    ['posPrice', t.layerPos],
                    ['subscriberPrice', t.subscriberPrice],
                  ] as const).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input inputMode="numeric" value={prices[key]} onChange={(event) => setPrices((current) => ({ ...current, [key]: event.target.value }))} />
                    </label>
                  ))}
                  <button type="button" className="secondary" onClick={() => void saveChain()}>{t.save}</button>
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
                          <option key={row.loginName} value={row.loginName}>{row.nickname} · {layerName(t, row.layer)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t.price}
                      <input inputMode="numeric" value={offerPrice} onChange={(event) => setOfferPrice(event.target.value)} />
                    </label>
                    <button type="button" disabled={!loginName || offerPrice === ''} onClick={() => void saveOffer()}>{t.save}</button>
                  </div>
                  <table className="data">
                    <thead>
                      <tr><th>{t.accountName}</th><th>{t.layer}</th><th>{t.price}</th><th></th></tr>
                    </thead>
                    <tbody>
                      {sheet.offers.map((offer) => (
                        <tr key={offer.loginName}>
                          <td>{offer.nickname}</td>
                          <td>{layerName(t, offer.layer)}</td>
                          <td><Money value={offer.price} /></td>
                          <td>
                            <RowMenu
                              label={t.lineOps}
                              items={[{
                                label: t.deleteAccount,
                                danger: true,
                                onClick: () => void api.removeOffer(sheet.code, offer.loginName).then(() => load()),
                              }]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Desk>
  );
}
