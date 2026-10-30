'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Desk, OutcomePick, lineStatus } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { RowMenu } from '../../components/row-menu';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type ApplyResult, type LineRow, type Outcome, type PackageRow, type PosChoice } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

export default function NumbersPage() {
  const { t, apiText, locale } = usePrefs();
  const [page, setPage] = useState<{ key: string; lines: LineRow[]; next: string | null } | null>(null);
  const [more, setMore] = useState(false);
  const [poses, setPoses] = useState<PosChoice[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [posLogin, setPosLogin] = useState('');
  const [packageCode, setPackageCode] = useState('');
  const [esim, setEsim] = useState(false);
  const [iccid, setIccid] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [packagesReady, setPackagesReady] = useState(false);
  const [urlRead, setUrlRead] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [pack, setPack] = useState('');
  const [needle, setNeedle] = useState('');
  const ticket = useRef(0);
  const { me } = useOffice();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  // The server filters and pages. Each filter set has a key; a page only shows while its key is current.
  const filterKey = `${needle}|${status}|${pack}`;
  const current = page?.key === filterKey ? page : null;
  const shown = current?.lines ?? [];
  const ready = packagesReady && page !== null;

  const loadFirst = useCallback(async () => {
    const mine = ++ticket.current;
    const result = await api.officeLines({ q: needle, status, packageCode: pack });
    if (mine !== ticket.current) return;
    const key = `${needle}|${status}|${pack}`;
    if (!result.ok) {
      setError(apiText(result.message));
      setPage({ key, lines: [], next: null });
      return;
    }
    setPage({ key, lines: result.data.lines, next: result.data.nextCursor });
    setPoses(result.data.poses);
    setPosLogin((currentLogin) => currentLogin || result.data.poses[0]?.loginName || '');
  }, [apiText, needle, status, pack]);

  async function loadMore() {
    if (!current?.next || more) return;
    const key = current.key;
    setMore(true);
    const result = await api.officeLines({ q: needle, status, packageCode: pack, cursor: current.next });
    setMore(false);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setPage((now) => (now && now.key === key ? { key, lines: [...now.lines, ...result.data.lines], next: result.data.nextCursor } : now));
  }

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('status') ?? '';
    if (initial === 'active' || initial === 'frozen' || initial === 'disconnected') {
      setStatus(initial);
    }
    setUrlRead(true);
    api.officePackages().then((result) => {
      if (!result.ok) {
        setError(apiText(result.message));
        return;
      }
      setPackages(result.data.packages);
      setPackageCode((currentCode) => currentCode || result.data.packages[0]?.code || '');
      setPackagesReady(true);
    });
  }, [apiText]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (urlRead) loadFirst();
  }, [urlRead, loadFirst]);

  function applied(result: { ok: true; data: ApplyResult } | { ok: false; message: string }) {
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setNote(result.data.applied ? t.appliedNow : t.sentToBranch);
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNote('');
    const result = await api.activateLine({ packageCode, posLogin, esim, iccid, msisdn: '', outcome: verdict });
    applied(result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message });
    if (result.ok) {
      setIccid('');
      setActivateOpen(false);
      await loadFirst();
    }
  }

  const packageOptions = packages.map((row) => ({
    code: row.code,
    label: row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`,
  }));
  const activeFilters = Number(Boolean(query.trim())) + Number(Boolean(status)) + Number(Boolean(pack));

  async function run(id: string, work: () => Promise<{ ok: true; data: ApplyResult } | { ok: false; message: string }>) {
    setError('');
    setNote('');
    const result = await work();
    applied(result);
    if (result.ok) await loadFirst();
  }

  return (
    <Desk
      title={t.numbersTitle}
      lede=""
      action={ready && me && me.layer !== 'pos' ? (
        <button type="button" className="primary" onClick={() => setActivateOpen(true)}>{t.activateLine}</button>
      ) : undefined}
      error={error}
      note={note}
    >
      <div className="filter-bar">
          <div className="pane-tools">
            {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
          </div>
          <div className="filter-panel">
            <label>
              {t.numberSearch}
              <input value={query} dir="ltr" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label>
              {t.status}
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{t.allRows}</option>
                <option value="active">{t.lineActive}</option>
                <option value="frozen">{t.lineFrozen}</option>
                <option value="disconnected">{t.lineDisconnected}</option>
              </select>
            </label>
            <label>
              {t.packageName}
              <select value={pack} onChange={(event) => setPack(event.target.value)}>
                <option value="">{t.allRows}</option>
                {packageOptions.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={() => { setQuery(''); setNeedle(''); setStatus(''); setPack(''); }}>
              {t.clearFilters}
            </button>
          </div>
        </div>
        <section className="pane" id="lines">
          {ready && me && me.layer !== 'pos' && (
            <Dialog
              open={activateOpen}
              title={t.activateLine}
              closeLabel={t.closeMenu}
              error={error}
              onClose={() => setActivateOpen(false)}
              footer={(
                <>
                  <button type="button" className="secondary" onClick={() => setActivateOpen(false)}>{t.cancel}</button>
                  <button type="submit" form="activate-line" className="primary">{t.actActivate}</button>
                </>
              )}
            >
              <form id="activate-line" className="dialog-form" onSubmit={activate}>
                <div className="pair">
                  <label>
                    {t.pointOfSale}
                    <select value={posLogin} onChange={(event) => setPosLogin(event.target.value)}>
                      {poses.map((pos) => (
                        <option key={pos.loginName} value={pos.loginName}>
                          {pos.nickname} · {pos.loginName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.packageName}
                    <select value={packageCode} onChange={(event) => setPackageCode(event.target.value)}>
                      {packages.map((row) => (
                        <option key={row.code} value={row.code}>
                          {row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" checked={esim} onChange={(event) => setEsim(event.target.checked)} />
                  {t.esim}
                </label>
                {!esim && (
                  <label>
                    {t.iccid}
                    <input value={iccid} onChange={(event) => setIccid(event.target.value)} dir="ltr" />
                  </label>
                )}
                <OutcomePick value={outcome} onChange={setOutcome} />
              </form>
            </Dialog>
          )}
          <div className="sheet">
            {!ready || !current ? <TableSkeleton rows={5} columns={isPos ? 5 : 6} /> : shown.length === 0 ? (
              <p className="empty" style={{ padding: 14 }}>
                {activeFilters > 0 ? t.noMatches : t.noLines}
              </p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.number}</th>
                    <th>{t.company}</th>
                    <th>{t.packageName}</th>
                    {!isPos && <th>{t.pointOfSale}</th>}
                    <th>{t.status}</th>
                    <th>{t.endsOn}</th>
                    <th className="row-actions">{t.lineOps}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((line) => {
                    const items = [
                      ...(line.status === 'active' ? [{ label: t.extend, icon: 'extend' as const, onClick: () => run(line.id, () => api.extendLine(line.id, verdict)) }] : []),
                      ...(line.status === 'frozen' ? [{ label: t.unfreeze, icon: 'undo' as const, onClick: () => run(line.id, () => api.unfreezeLine(line.id, verdict)) }] : []),
                      ...(line.status === 'disconnected' ? [{ label: t.actActivate, icon: 'check' as const, onClick: () => run(line.id, () => api.reactivateLine(line.id, verdict)) }] : []),
                      ...(line.status !== 'disconnected' ? [{ label: t.disconnect, icon: 'ban' as const, danger: true, onClick: () => run(line.id, () => api.disconnectLine(line.id, verdict)) }] : []),
                    ];
                    return (
                      <tr key={line.id}>
                        <td className="msisdn">
                          <Link className="num-link" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link>
                        </td>
                        <td>{line.companyName || '—'}</td>
                        <td>{line.packageName}</td>
                        {!isPos && <td><bdi dir="ltr">{line.posLogin}</bdi></td>}
                        <td>
                          <span className={line.status === 'active' ? 'badge' : line.status === 'frozen' ? 'badge pending' : 'badge cancelled'}>{lineStatus(t, line.status)}</span>
                        </td>
                        <td>{new Date(line.endsAt).toLocaleDateString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar')}</td>
                        <td className="row-actions">
                          <RowMenu label={`${t.lineOps} ${line.msisdn}`} items={items} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {current?.next && (
            <div className="pane-body">
              <div className="pane-tools">
                <button type="button" className="secondary" disabled={more} onClick={loadMore}>{t.loadMore}</button>
                {more && <Spinner size={18} />}
                <span className="hint">{t.shownCount.replace('{n}', String(shown.length))}</span>
              </div>
            </div>
          )}
        </section>
    </Desk>
  );
}
