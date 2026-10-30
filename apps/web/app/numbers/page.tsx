'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Desk, OutcomePick, lineStatus } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { RowMenu } from '../../components/row-menu';
import { TableSkeleton } from '../../components/loading';
import { api, type ApplyResult, type LineRow, type Outcome, type PackageRow, type PosChoice } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

export default function NumbersPage() {
  const { t, apiText, locale } = usePrefs();
  const [lines, setLines] = useState<LineRow[]>([]);
  const [poses, setPoses] = useState<PosChoice[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [posLogin, setPosLogin] = useState('');
  const [packageCode, setPackageCode] = useState('');
  const [esim, setEsim] = useState(false);
  const [iccid, setIccid] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [pack, setPack] = useState('');
  const { me } = useOffice();
  const door = useDoor();
  const isPos = door.layer === 'pos' || me?.layer === 'pos';
  const verdict: Outcome = isPos ? 'success' : outcome;

  const load = useCallback(async () => {
    const [lineResult, packageResult] = await Promise.all([api.officeLines(), api.officePackages()]);
    if (!lineResult.ok) {
      setError(apiText(lineResult.message));
      return;
    }
    if (!packageResult.ok) {
      setError(apiText(packageResult.message));
      return;
    }
    setLines(lineResult.data.lines);
    setPoses(lineResult.data.poses);
    setPackages(packageResult.data.packages);
    setPosLogin((current) => current || lineResult.data.poses[0]?.loginName || '');
    setPackageCode((current) => current || packageResult.data.packages[0]?.code || '');
    setReady(true);
  }, [apiText]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('status') ?? '';
    if (initial === 'active' || initial === 'frozen' || initial === 'disconnected') {
      setStatus(initial);
    }
    load();
  }, [load]);

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
      await load();
    }
  }

  const needle = query.replace(/\s/g, '');
  const shown = lines.filter((line) => {
    if (status && line.status !== status) return false;
    if (pack && line.packageCode !== pack) return false;
    if (needle && !line.msisdn.includes(needle)) return false;
    return true;
  });
  const packageOptions = [...new Map(lines.map((line) => {
    const row = packages.find((item) => item.code === line.packageCode);
    const label = row
      ? (row.providerName ? `${row.providerName} · ${row.companyName} · ${row.name}` : `${row.companyName} · ${row.name}`)
      : line.packageName;
    return [line.packageCode, { code: line.packageCode, label }] as const;
  })).values()];
  const activeFilters = Number(Boolean(needle)) + Number(Boolean(status)) + Number(Boolean(pack));

  async function run(id: string, work: () => Promise<{ ok: true; data: ApplyResult } | { ok: false; message: string }>) {
    setError('');
    setNote('');
    const result = await work();
    applied(result);
    if (result.ok) await load();
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
            <button type="button" className="secondary" onClick={() => { setQuery(''); setStatus(''); setPack(''); }}>
              {t.clearFilters}
            </button>
          </div>
        </div>
        <section className="pane" id="lines">
          {ready && me && me.layer !== 'pos' && (
            <Dialog open={activateOpen} title={t.activateLine} closeLabel={t.closeMenu} error={error} onClose={() => setActivateOpen(false)}>
              <form className="dialog-form" onSubmit={activate}>
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
                <button type="submit">{t.actActivate}</button>
              </form>
            </Dialog>
          )}
          <div className="sheet">
            {!ready ? <TableSkeleton rows={5} columns={isPos ? 5 : 6} /> : shown.length === 0 ? (
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
                    <th>{t.lineOps}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((line) => {
                    const items = [
                      ...(line.status === 'active' ? [{ label: t.extend, onClick: () => run(line.id, () => api.extendLine(line.id, verdict)) }] : []),
                      ...(line.status === 'frozen' ? [{ label: t.unfreeze, onClick: () => run(line.id, () => api.unfreezeLine(line.id, verdict)) }] : []),
                      ...(line.status === 'disconnected' ? [{ label: t.actActivate, onClick: () => run(line.id, () => api.reactivateLine(line.id, verdict)) }] : []),
                      ...(line.status !== 'disconnected' ? [{ label: t.disconnect, danger: true, onClick: () => run(line.id, () => api.disconnectLine(line.id, verdict)) }] : []),
                    ];
                    const visible = items.find((item) => !item.danger);
                    const rest = items.filter((item) => item !== visible);
                    return (
                      <tr key={line.id}>
                        <td className="msisdn">
                          <Link className="num-link" href={`/numbers/${line.id}`}><bdi dir="ltr">{line.msisdn}</bdi></Link>
                        </td>
                        <td>{line.companyName || '—'}</td>
                        <td>{line.packageName}</td>
                        {!isPos && <td>{line.posLogin}</td>}
                        <td>
                          <span className={line.status === 'active' ? 'badge' : line.status === 'frozen' ? 'badge pending' : 'badge cancelled'}>{lineStatus(t, line.status)}</span>
                        </td>
                        <td>{new Date(line.endsAt).toLocaleDateString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar')}</td>
                        <td>
                          {visible && (
                            <button type="button" className="secondary" onClick={visible.onClick}>{visible.label}</button>
                          )}
                          {rest.length > 0 && <RowMenu label={t.lineOps} items={rest} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
    </Desk>
  );
}
