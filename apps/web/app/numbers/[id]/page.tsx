'use client';

import { ArrowRightLeft, CalendarPlus, Hash, Layers, PhoneOff, QrCode, RefreshCw, Smartphone, Snowflake, Sun, Zap } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, OutcomePick, actionName, applyNote, latinWhen, lineStatus } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { DisconnectConfirm } from '../../../components/disconnect-confirm';
import { EsimDialog, QrPicker } from '../../../components/esim-qr';
import { lineActions, type RunLine } from '../../../components/line-actions';
import { TableSkeleton } from '../../../components/loading';
import type { RowAction } from '../../../components/row-menu';
import { LineChoice } from '../../../components/transfer-dialog';
import { Button } from '../../../components/ui/button';
import { api, type LineHistory, type LineRow, type Outcome, type PackageRow, type Shelf, type TransferLinePrices } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { OPEN_SIM, hasSimRules, simFits, simHint } from '../../../lib/sim-rules';
import { useAction } from '../../../lib/use-action';
import { formatShekel } from '../../../lib/money';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { lineTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { DataImage } from '../../../components/data-image';

const tabs = ['ops', 'details', 'log'] as const;
type Tab = (typeof tabs)[number];
type DialogName = 'sim' | 'esim' | 'rename' | 'switch' | 'transfer' | 'qr' | null;

const glyph = { size: 22, strokeWidth: 2, 'aria-hidden': true as const };

function tileIcon(item: RowAction) {
  if (item.danger) return <PhoneOff {...glyph} />;
  if (item.icon === 'undo') return <Sun {...glyph} />;
  if (item.icon === 'check') return <Zap {...glyph} />;
  if (item.icon === 'refresh') return <RefreshCw {...glyph} />;
  if (item.icon === 'ban') return <Snowflake {...glyph} />;
  return <CalendarPlus {...glyph} />;
}

function daysLeft(endsAt: string): number {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

const NO_PACKAGES: PackageRow[] = [];
const NO_COMPANIES: Shelf['companies'] = [];

export default function LineCardPage() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const door = useDoor();
  const { me } = useOffice();
  const isPos = door.layer === 'pos';
  // The grant moves a number; a stopped transfer takes the action away, as the server would refuse it.
  const canTransfer = Boolean(me?.grants.includes('transferLines') && !me.stops.includes('transfer'));
  const [tab, setTab] = useState<Tab>('ops');
  const [outcome, setOutcome] = useState<Outcome>('success');
  const [dialog, setDialog] = useState<DialogName>(null);
  const [ending, setEnding] = useState<LineRow | null>(null);
  const [switchTo, setSwitchTo] = useState('');
  const [nextIccid, setNextIccid] = useState('');
  const [nextEsim, setNextEsim] = useState(false);
  const [nextQr, setNextQr] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  const [posLogin, setPosLogin] = useState('');
  // What happens to the number's renewal price when it moves. Empty until chosen: there is no default.
  const [linePrices, setLinePrices] = useState<'' | TransferLinePrices>('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const verdict: Outcome = isPos ? 'success' : outcome;

  // Three reads, each cached on its own (ADR 0001): the number, the catalog (shared with the numbers list) and the
  // accounts (shared with the users page). An action on the number asks for the number again, not the other two.
  const numberRead = useApiQuery(sharedKeys.line(params.id), () => api.officeLine(params.id));
  const catalogRead = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const usersRead = useApiQuery(sharedKeys.users, () => api.officeUsers(), { enabled: canTransfer });
  const card = {
    loaded: numberRead.loaded && catalogRead.loaded && (!canTransfer || usersRead.loaded),
    // The catalog and the accounts are helpers: without them the card still shows, with fewer choices.
    error: numberRead.error,
    reload: numberRead.reload,
  };
  const line = numberRead.data?.line ?? null;
  const history = numberRead.data?.history ?? [];
  const packages = catalogRead.data?.packages ?? NO_PACKAGES;
  const companies = catalogRead.data?.companies ?? NO_COMPANIES;
  const posChoices = useMemo(
    () => (usersRead.data?.users ?? []).filter((row) => row.layer === 'pos').map((row) => ({ loginName: row.loginName, nickname: row.nickname })),
    [usersRead.data],
  );
  const { run: act, busy } = useAction({ setError, setNote, onDone: card.reload });
  const run: RunLine = (work) => act(work, { note: (data) => applyNote(t, data) });
  const closeDialog = useCallback(() => {
    setDialog(null);
    setSwitchTo('');
    setNextIccid('');
    setNextEsim(false);
    setNextQr('');
    setNextNumber('');
    setPosLogin('');
    setLinePrices('');
  }, []);

  const names: Record<Tab, string> = { ops: t.lineOps, details: t.lineDetails, log: t.lineLog };
  const items = line ? lineActions(line, verdict, run, t, { freeze: true, onDisconnect: setEnding }) : [];
  const allows = (key: string, fallback: boolean) => (line?.operations ? line.operations.includes(key) : fallback);
  const targets = new Set(line?.switchTargets ?? []);
  const switchChoices = packages.filter((row) => targets.has(row.code));
  const logColumns: Column<LineHistory>[] = [
    { key: 'kind', header: t.kind, render: (row) => actionName(t, row.action) },
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    { key: 'number', header: t.number, render: (row) => (row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—') },
    { key: 'company', header: t.company, render: (row) => row.companyName || '—' },
    { key: 'package', header: t.packageName, render: (row) => row.packageName || '—' },
    { key: 'actor', header: t.actedBy, render: (row) => (row.actorName ? <bdi>{row.actorName}</bdi> : '—') },
  ];
  const internetCap = line?.dataGb == null ? '—' : String(line.dataGb);
  const simRules = line?.sim ?? OPEN_SIM;
  const simLabel = (row: LineRow) => (row.iccid ? <bdi dir="ltr">{row.iccid}</bdi> : row.esim ? t.esim : '—');

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
              <Badge variant={lineTone(line.status)} dot>{lineStatus(t, line.status)}</Badge>
            </header>
            <div className="steps" role="tablist">
              {tabs.map((item) => (
                <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
                  {names[item]}
                </button>
              ))}
            </div>
            {tab === 'ops' && (
              <div className="pane-body line-ops">
                {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
                <div className="op-board">
                  {items.length > 0 && (
                    <div className="command-list">
                      {items.map((item) => (
                        <button key={item.label} type="button" className={item.danger ? 'op-card danger' : 'op-card'} onClick={item.onClick}>
                          {tileIcon(item)}
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {allows('sim', line.status === 'active' && !line.opsLocked) && (
                    <button type="button" className="op-tile" onClick={() => { setNextIccid(simRules.prefix); setDialog('sim'); }}>
                      <Smartphone {...glyph} />
                      {t.swapSim}
                    </button>
                  )}
                  {allows('esim', false) && (
                    <button type="button" className="op-tile" onClick={() => setDialog('esim')}>
                      <QrCode {...glyph} />
                      {t.requestEsim}
                    </button>
                  )}
                  {allows('rename', line.status === 'active' && !line.opsLocked) && (
                    <button type="button" className="op-tile" onClick={() => setDialog('rename')}>
                      <Hash {...glyph} />
                      {t.changeNumber}
                    </button>
                  )}
                  {allows('switch', line.status === 'active' || Boolean(line.opsLocked)) && (
                    <button type="button" className="op-tile" onClick={() => setDialog('switch')}>
                      <Layers {...glyph} />
                      {t.actSwitch}
                    </button>
                  )}
                  {canTransfer && (
                    <button type="button" className="op-tile" onClick={() => setDialog('transfer')}>
                      <ArrowRightLeft {...glyph} />
                      {t.transfer}
                    </button>
                  )}
                </div>
              </div>
            )}
            {tab === 'details' && (
              <div className="pane-body line-details">
                <dl className="detail-rows">
                  <div><dt>{t.company}</dt><dd>{line.companyName || '—'}</dd></div>
                  <div><dt>{t.packageName}</dt><dd>{line.packageName}</dd></div>
                  <div><dt>{t.simType}</dt><dd>{line.esim ? t.esim : t.physicalSim}</dd></div>
                  <div><dt>{t.simSerial}</dt><dd>{line.iccid ? <bdi dir="ltr">{line.iccid}</bdi> : '—'}</dd></div>
                  {line.esim && line.esimQr && (
                    <div><dt>{t.esimQr}</dt><dd><Button type="button" variant="secondary" size="iconSm" aria-label={t.showQr} title={t.showQr} onClick={() => setDialog('qr')}><QrCode size={16} strokeWidth={1.75} aria-hidden="true" /></Button></dd></div>
                  )}
                  <div><dt>{t.endsOn}</dt><dd><bdi dir="ltr">{latinWhen(line.endsAt).slice(0, 10)}</bdi></dd></div>
                  <div><dt>{t.remainingDays}</dt><dd>{daysLeft(line.endsAt)} {t.dayUnit}</dd></div>
                  <div><dt>{t.lastRecharge}</dt><dd>{line.lastRechargeAt ? <bdi dir="ltr">{latinWhen(line.lastRechargeAt)}</bdi> : '—'}</dd></div>
                  <div><dt>{t.subscriptionPrice}</dt><dd><Money value={line.subscriberPrice ?? line.posPrice} /></dd></div>
                  {!isPos && line.posLogin && <div><dt>{t.pointOfSale}</dt><dd><AccountName login={line.posLogin} /></dd></div>}
                </dl>
                <section className="usage">
                  <h2>{t.usage}</h2>
                  <div className="usage-meters">
                    <div className="usage-meter">
                      <span className="usage-dial"><b>—</b></span>
                      <span>{t.messages}</span>
                      <span className="hint">—</span>
                    </div>
                    <div className="usage-meter">
                      <span className="usage-dial"><b>—</b></span>
                      <span>{t.minutes}</span>
                      <span className="hint">—</span>
                    </div>
                    <div className="usage-meter">
                      <span className="usage-dial"><b>—</b></span>
                      <span>{t.internet}</span>
                      <span className="hint"><bdi dir="ltr">— / {internetCap}</bdi></span>
                    </div>
                  </div>
                </section>
              </div>
            )}
            {tab === 'log' && <DataTable columns={logColumns} rows={history} rowKey={(row) => row.id} empty={t.noHistory} />}
          </section>
        )}
      </div>
      {line && (
        <>
          <DisconnectConfirm
            line={ending}
            busy={busy}
            failing={verdict === 'fail'}
            onClose={() => setEnding(null)}
            onConfirm={(row) => act(() => api.disconnectLine(row.id, verdict), { note: (data) => applyNote(t, data) })}
          />
          <Dialog
            open={dialog === 'sim'}
            title={t.swapSim}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            mark="key"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy || nextIccid.trim().length < 8 || !simFits(simRules, nextIccid.trim())}
                  onClick={() => act(
                    () => api.swapSim(line.id, { iccid: nextIccid.trim(), esim: nextEsim, qr: nextEsim && nextQr ? nextQr : null }, verdict),
                    { note: (data) => applyNote(t, data), then: closeDialog },
                  )}
                >
                  {t.swapSim}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <dl className="detail-rows">
                <div><dt>{t.currentSim}</dt><dd>{simLabel(line)}</dd></div>
              </dl>
              <label>
                {t.newSim}
                <input value={nextIccid} inputMode="numeric" dir="ltr" onChange={(event) => setNextIccid(event.target.value)} />
                {hasSimRules(simRules) && <span className="hint">{simHint(t, simRules)}</span>}
              </label>
              {simRules.esim && (
                <label className="check">
                  <input type="checkbox" checked={nextEsim} onChange={(event) => setNextEsim(event.target.checked)} />
                  {t.esim}
                </label>
              )}
              {nextEsim && (
                <div className="stack">
                  <span className="hint">{t.qrImage}</span>
                  <QrPicker value={nextQr} onChange={setNextQr} disabled={busy} />
                </div>
              )}
              <p className="hint">{t.swapEsimHint}</p>
            </div>
          </Dialog>
          <Dialog
            open={dialog === 'esim'}
            title={t.requestEsim}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            size="confirm"
            mark="plus"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => api.requestEsim(line.id), { note: (data) => applyNote(t, data), then: closeDialog })}
                >
                  {t.requestEsim}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <dl className="detail-rows">
                <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
                <div><dt>{t.currentSim}</dt><dd>{simLabel(line)}</dd></div>
                <div><dt>{t.esimPrice}</dt><dd><Money value={line.esimPrice ?? 0} /></dd></div>
              </dl>
              <p className="hint">{t.requestEsimHint.replace('{price}', formatShekel(line.esimPrice ?? 0))}</p>
            </div>
          </Dialog>
          <Dialog
            open={dialog === 'rename'}
            title={t.changeNumber}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            mark="key"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy || (nextNumber.trim() !== '' && !/^05\d{8}$/.test(nextNumber.trim()))}
                  onClick={() => act(() => api.renameLine(line.id, nextNumber.trim(), verdict), { note: (data) => applyNote(t, data), then: closeDialog })}
                >
                  {t.changeNumber}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <dl className="detail-rows">
                <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
              </dl>
              <label>
                {t.newNumber}
                <input value={nextNumber} inputMode="numeric" dir="ltr" onChange={(event) => setNextNumber(event.target.value)} />
                <span className="hint">{t.newNumberLater}</span>
              </label>
            </div>
          </Dialog>
          <EsimDialog line={dialog === 'qr' ? line : null} onClose={closeDialog} />
          <Dialog
            open={dialog === 'switch'}
            title={t.actSwitch}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            size="wide"
            mark="transfer"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy || !switchTo}
                  onClick={() => act(() => api.switchLine(line.id, switchTo, verdict), { note: (data) => applyNote(t, data), then: closeDialog })}
                >
                  {t.actSwitch}
                </Button>
              </>
            )}
          >
            {switchChoices.length === 0 ? (
              <p className="hint">{t.noSwitchTargets}</p>
            ) : (
              <div className="pack-picks">
                {switchChoices.map((row) => {
                  const image = companies.find((company) => company.name === row.companyName)?.image;
                  return (
                    <button key={row.code} type="button" className={switchTo === row.code ? 'pack-pick is-on' : 'pack-pick'} onClick={() => setSwitchTo(row.code)}>
                      {image ? <DataImage src={image} alt="" /> : <span>{row.companyName.slice(0, 1)}</span>}
                      <b>{row.companyName}</b>
                      <span>{row.name}</span>
                      <Money value={row.subscriberPrice} />
                    </button>
                  );
                })}
              </div>
            )}
          </Dialog>
          <Dialog
            open={dialog === 'transfer'}
            title={t.transfer}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            mark="transfer"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy || !posLogin || !linePrices}
                  onClick={() => {
                    if (linePrices) void act(() => api.transferLine(line.id, posLogin, linePrices), { note: t.transfer, then: closeDialog });
                  }}
                >
                  {t.transfer}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <dl className="detail-rows">
                <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
                <div><dt>{t.pointOfSale}</dt><dd><AccountName login={line.posLogin} /></dd></div>
              </dl>
              <label>
                {t.transfer}
                <Select value={posLogin} onChange={(event) => setPosLogin(event.target.value)}>
                  <option value="">—</option>
                  {posChoices.map((row) => <option key={row.loginName} value={row.loginName}>{accountLabel(row.loginName, row.nickname)}</option>)}
                </Select>
              </label>
              <LineChoice value={linePrices} onChange={setLinePrices} />
            </div>
          </Dialog>
        </>
      )}
    </Desk>
  );
}
