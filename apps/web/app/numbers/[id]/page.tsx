'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, OutcomePick, actionName, lineStatus } from '../../../components/desk';
import { TableSkeleton } from '../../../components/loading';
import { api, type ApplyResult, type LineHistory, type LineRow, type Outcome, type PackageRow } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { usePrefs } from '../../../lib/prefs';

const tabs = ['ops', 'details', 'log'] as const;
type Tab = (typeof tabs)[number];

export default function LineCardPage() {
  const { t, apiText, locale } = usePrefs();
  const params = useParams<{ id: string }>();
  const door = useDoor();
  const isPos = door.layer === 'pos';
  const [line, setLine] = useState<LineRow | null>(null);
  const [history, setHistory] = useState<LineHistory[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [tab, setTab] = useState<Tab>('ops');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [switchTo, setSwitchTo] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  const [nextIccid, setNextIccid] = useState('');
  const [posLogin, setPosLogin] = useState('');
  const [posChoices, setPosChoices] = useState<{ loginName: string; nickname: string }[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);
  const verdict: Outcome = isPos ? 'success' : outcome;

  const load = useCallback(async () => {
    const [card, catalog] = await Promise.all([api.officeLine(params.id), api.officePackages()]);
    if (!card.ok) {
      setError(apiText(card.message));
      setLine(null);
      setReady(true);
      return;
    }
    setLine((current) => {
      if (!current) setTab('ops');
      return card.data.line;
    });
    setHistory(card.data.history);
    if (catalog.ok) setPackages(catalog.data.packages);
    setError('');
    setReady(true);
    if (door.layer !== 'pos') {
      const users = await api.officeUsers();
      if (users.ok) setPosChoices(users.data.users.filter((row) => row.layer === 'pos').map((row) => ({ loginName: row.loginName, nickname: row.nickname })));
    }
  }, [apiText, params.id, door.layer]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(work: () => Promise<{ ok: true; data: ApplyResult } | { ok: false; message: string }>) {
    setError('');
    setNote('');
    const result = await work();
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setNote(result.data.applied ? t.appliedNow : t.sentToBranch);
    await load();
  }

  const names: Record<Tab, string> = { ops: t.lineOps, details: t.lineDetails, log: t.lineLog };
  const stamp = (value: string) => new Date(value).toLocaleString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar');

  return (
    <Desk title={t.lineCard} lede="" error={error} note={note}>
      <div className="stack">
        <Link className="back-link" href="/numbers">{t.navNumbers}</Link>
        {!ready ? (
          <section className="pane">
            <header className="pane-head" />
            <TableSkeleton rows={4} columns={2} />
          </section>
        ) : line && (
          <section className="pane">
            <header className="line-head">
              <p className="line-number"><bdi dir="ltr">{line.msisdn}</bdi></p>
              <span className={line.status === 'active' ? 'badge' : line.status === 'frozen' ? 'badge pending' : 'badge cancelled'}>{lineStatus(t, line.status)}</span>
            </header>
            <div className="steps" role="tablist">
              {tabs.map((item) => (
                <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
                  {names[item]}
                </button>
              ))}
            </div>
            {tab === 'ops' && (
              <div className="pane-body">
                {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
                {!line.opsLocked && <div className="op-grid">
                  {line.status === 'active' && (
                    <button type="button" className="op-card" onClick={() => run(() => api.extendLine(line.id, verdict))}>
                      {t.extend}
                    </button>
                  )}
                  {line.status === 'disconnected' && (
                    <button type="button" className="op-card" onClick={() => run(() => api.reactivateLine(line.id, verdict))}>
                      {t.actActivate}
                    </button>
                  )}
                  {line.status === 'active' && (
                    <button type="button" className="op-card" onClick={() => run(() => api.freezeLine(line.id, verdict))}>
                      {t.freeze}
                    </button>
                  )}
                  {line.status === 'frozen' && (
                    <button type="button" className="op-card" onClick={() => run(() => api.unfreezeLine(line.id, verdict))}>
                      {t.unfreeze}
                    </button>
                  )}
                  {line.status !== 'disconnected' && (
                    <button type="button" className="op-card" onClick={() => run(() => api.disconnectLine(line.id, verdict))}>
                      {t.disconnect}
                    </button>
                  )}
                </div>}
                {!isPos && (
                  <div className="switch-row">
                    <label>
                      {t.transfer}
                      <select value={posLogin} onChange={(event) => setPosLogin(event.target.value)}>
                        <option value="">—</option>
                        {posChoices.map((row) => <option key={row.loginName} value={row.loginName}>{row.nickname}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={!posLogin} onClick={async () => {
                      const result = await api.transferLine(line.id, posLogin);
                      if (!result.ok) setError(apiText(result.message));
                      else { setNote(t.transfer); await load(); }
                    }}>{t.transfer}</button>
                  </div>
                )}
                {line.status === 'active' && !line.opsLocked && (
                  <div className="switch-row">
                    <label>
                      {t.updateNumber}
                      <input value={nextNumber} dir="ltr" onChange={(event) => setNextNumber(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      disabled={!/^05\d{8}$/.test(nextNumber)}
                      onClick={() => run(() => api.renameLine(line.id, nextNumber, verdict))}
                    >
                      {t.updateNumber}
                    </button>
                  </div>
                )}
                {line.status === 'active' && !line.opsLocked && (
                  <div className="switch-row">
                    <label>
                      {t.swapSim}
                      <input value={nextIccid} dir="ltr" onChange={(event) => setNextIccid(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      disabled={nextIccid.trim().length < 8}
                      onClick={() => run(() => api.swapSim(line.id, nextIccid.trim(), verdict))}
                    >
                      {t.swapSim}
                    </button>
                  </div>
                )}
                {(line.status === 'active' || line.opsLocked) && (
                  <div className="switch-row">
                    <label>
                      {t.switchTo}
                      <select value={switchTo} onChange={(event) => setSwitchTo(event.target.value)}>
                        <option value="">{t.switchTo}</option>
                        {packages
                          .filter((row) => row.code !== line.packageCode)
                          .map((row) => (
                            <option key={row.code} value={row.code}>
                              {row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button type="button" disabled={!switchTo} onClick={() => run(() => api.switchLine(line.id, switchTo, verdict))}>
                      {t.actSwitch}
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === 'details' && (
              <dl className="facts">
                <div><dt>{t.company}</dt><dd>{line.companyName || '—'}</dd></div>
                <div><dt>{t.packageName}</dt><dd>{line.packageName}</dd></div>
                <div><dt>{t.price}</dt><dd><Money value={line.posPrice} /></dd></div>
                <div><dt>{line.esim ? t.esim : t.iccid}</dt><dd dir="ltr">{line.esim ? t.esim : line.iccid || '—'}</dd></div>
                <div><dt>{t.started}</dt><dd>{stamp(line.createdAt)}</dd></div>
                <div><dt>{t.endsOn}</dt><dd>{stamp(line.endsAt)}</dd></div>
                <div><dt>{t.status}</dt><dd>{lineStatus(t, line.status)}</dd></div>
                {!isPos && line.posLogin && <div><dt>{t.pointOfSale}</dt><dd>{line.posLogin}</dd></div>}
              </dl>
            )}
            {tab === 'log' && (
              history.length === 0 ? (
                <p className="empty" style={{ padding: 14 }}>{t.noHistory}</p>
              ) : (
                <div className="sheet">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t.kind}</th>
                        <th>{t.when}</th>
                        <th>{t.number}</th>
                        <th>{t.company}</th>
                        <th>{t.packageName}</th>
                        <th>{t.actedBy}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id}>
                          <td>{actionName(t, row.action)}</td>
                          <td>{stamp(row.at)}</td>
                          <td>{row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—'}</td>
                          <td>{row.companyName || '—'}</td>
                          <td>{row.packageName || '—'}</td>
                          <td>{row.actorName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>
        )}
      </div>
    </Desk>
  );
}
