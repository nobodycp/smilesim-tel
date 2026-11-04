'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, OutcomePick, actionName, latinWhen, lineStatus } from '../../../components/desk';
import { lineActions, type RunLine } from '../../../components/line-actions';
import { TableSkeleton } from '../../../components/loading';
import { Button } from '../../../components/ui/button';
import { api, type LineHistory, type Outcome } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';

const tabs = ['ops', 'details', 'log'] as const;
type Tab = (typeof tabs)[number];

export default function LineCardPage() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const door = useDoor();
  const { me } = useOffice();
  const isPos = door.layer === 'pos';
  const canTransfer = Boolean(me?.grants.includes('transferLines'));
  const [tab, setTab] = useState<Tab>('ops');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [switchTo, setSwitchTo] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  const [nextIccid, setNextIccid] = useState('');
  const [posLogin, setPosLogin] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const verdict: Outcome = isPos ? 'success' : outcome;

  const card = useLoad(async () => {
    const [found, catalog] = await Promise.all([api.officeLine(params.id), api.officePackages()]);
    if (!found.ok) return found;
    const users = canTransfer ? await api.officeUsers() : null;
    return {
      ok: true as const,
      data: {
        line: found.data.line,
        history: found.data.history,
        packages: catalog.ok ? catalog.data.packages : [],
        posChoices: users?.ok ? users.data.users.filter((row) => row.layer === 'pos').map((row) => ({ loginName: row.loginName, nickname: row.nickname })) : [],
      },
    };
  }, [params.id, canTransfer]);
  const line = card.data?.line ?? null;
  const history = card.data?.history ?? [];
  const packages = card.data?.packages ?? [];
  const posChoices = card.data?.posChoices ?? [];
  const { run: act } = useAction({ setError, setNote, onDone: card.reload });
  const run: RunLine = (work) => act(work, { note: (data) => (data.applied ? t.appliedNow : t.sentToBranch) });

  const names: Record<Tab, string> = { ops: t.lineOps, details: t.lineDetails, log: t.lineLog };
  const items = line ? lineActions(line, verdict, run, t, { freeze: true }) : [];
  const logColumns: Column<LineHistory>[] = [
    { key: 'kind', header: t.kind, render: (row) => actionName(t, row.action) },
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'actor', header: t.actedBy, render: (row) => row.actorName || '—' },
  ];

  return (
    <Desk title={t.lineCard} lede="" error={error || card.error} note={note}>
      <div className="stack">
        {!card.loaded ? (
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
                {items.length > 0 && (
                  <div className="command-list">
                    {items.map((item) => (
                      <button key={item.label} type="button" className={item.danger ? 'op-card danger' : 'op-card'} onClick={item.onClick}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="command-forms">
                  {canTransfer && (
                    <div className="switch-row">
                      <label>
                        {t.transfer}
                        <select value={posLogin} onChange={(event) => setPosLogin(event.target.value)}>
                          <option value="">—</option>
                          {posChoices.map((row) => <option key={row.loginName} value={row.loginName}>{row.nickname}</option>)}
                        </select>
                      </label>
                      <Button type="button" variant="secondary" size="sm" disabled={!posLogin} onClick={() => act(() => api.transferLine(line.id, posLogin), { note: t.transfer })}>{t.transfer}</Button>
                    </div>
                  )}
                  {line.status === 'active' && !line.opsLocked && (
                    <div className="switch-row">
                      <label>
                        {t.updateNumber}
                        <input value={nextNumber} dir="ltr" onChange={(event) => setNextNumber(event.target.value)} />
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!/^05\d{8}$/.test(nextNumber)}
                        onClick={() => run(() => api.renameLine(line.id, nextNumber, verdict))}
                      >
                        {t.updateNumber}
                      </Button>
                    </div>
                  )}
                  {line.status === 'active' && !line.opsLocked && (
                    <div className="switch-row">
                      <label>
                        {t.swapSim}
                        <input value={nextIccid} dir="ltr" onChange={(event) => setNextIccid(event.target.value)} />
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={nextIccid.trim().length < 8}
                        onClick={() => run(() => api.swapSim(line.id, nextIccid.trim(), verdict))}
                      >
                        {t.swapSim}
                      </Button>
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
                      <Button type="button" variant="secondary" size="sm" disabled={!switchTo} onClick={() => run(() => api.switchLine(line.id, switchTo, verdict))}>
                        {t.actSwitch}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {tab === 'details' && (
              <div className="pane-body">
                <dl className="facts">
                  <div><dt>{t.company}</dt><dd>{line.companyName || '—'}</dd></div>
                  <div><dt>{t.packageName}</dt><dd>{line.packageName}</dd></div>
                  <div><dt>{t.price}</dt><dd><Money value={line.posPrice} /></dd></div>
                  <div><dt>{line.esim ? t.esim : t.iccid}</dt><dd>{line.esim ? t.esim : <bdi dir="ltr">{line.iccid || '—'}</bdi>}</dd></div>
                  <div><dt>{t.started}</dt><dd><bdi dir="ltr">{latinWhen(line.createdAt)}</bdi></dd></div>
                  <div><dt>{t.endsOn}</dt><dd><bdi dir="ltr">{latinWhen(line.endsAt)}</bdi></dd></div>
                  <div><dt>{t.status}</dt><dd>{lineStatus(t, line.status)}</dd></div>
                  {!isPos && line.posLogin && <div><dt>{t.pointOfSale}</dt><dd><bdi dir="ltr">{line.posLogin}</bdi></dd></div>}
                </dl>
              </div>
            )}
            {tab === 'log' && <DataTable columns={logColumns} rows={history} rowKey={(row) => row.id} empty={t.noHistory} />}
          </section>
        )}
      </div>
    </Desk>
  );
}
