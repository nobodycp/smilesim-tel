'use client';

import { ArrowRightLeft, CalendarPlus, ChevronLeft, Hash, Layers, PhoneOff, PlusCircle, QrCode, RefreshCw, Smartphone, Snowflake, Sun, Zap } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
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
import { everyAccount } from '../../../lib/directory';
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
import { NameField } from '../../../components/name-field';
import { DataImage } from '../../../components/data-image';
import { Fact, Facts } from '../../../components/facts';
import { useCrumbs } from '../../../lib/crumbs';
import { usePageTitle } from '../../../lib/page-title';
import { LineDetails } from '../line-details';
import { Tabs } from '../../../components/tabs';
import { EXPIRING_DAYS, daysLeft } from '../../../lib/days-left';

// «التفاصيل» second, as key and value rows; no fact cards above the tabs (owner, 2026-11-11).
const tabs = ['ops', 'details', 'log'] as const;
type Tab = (typeof tabs)[number];
type DialogName = 'sim' | 'esim' | 'rename' | 'switch' | 'transfer' | 'qr' | 'addon' | null;

const glyph = { size: 18, strokeWidth: 1.9, 'aria-hidden': true as const };

function tileIcon(item: RowAction) {
  if (item.danger) return <PhoneOff {...glyph} />;
  if (item.icon === 'undo') return <Sun {...glyph} />;
  if (item.icon === 'check') return <Zap {...glyph} />;
  if (item.icon === 'refresh') return <RefreshCw {...glyph} />;
  if (item.icon === 'ban') return <Snowflake {...glyph} />;
  return <CalendarPlus {...glyph} />;
}


/** One operation on the number as a card (Graphite «op-card»): a crimson mark, the name, one line on what it does. */
function LineOp({ icon, title, text, danger, now, onClick }: { icon: ReactNode; title: string; text: string; danger?: boolean; now?: boolean; onClick: () => void }) {
  // `now`: an immediate operation (lineActions), as opposed to one that opens a form.
  return (
    <button type="button" className={danger ? 'line-op danger' : 'line-op'} data-now={now ? '' : undefined} aria-label={title} onClick={onClick}>
      <span className="line-op-mark">{icon}</span>
      <b>{title}</b>
      <span className="line-op-text">{text}</span>
      <ChevronLeft className="line-op-go flip-ltr" size={16} aria-hidden="true" />
    </button>
  );
}

/** What is left on an active number: crimson and worded when it ends soon. */
function LeftDays({ endsAt }: { endsAt: string }) {
  const { t } = usePrefs();
  const days = daysLeft(endsAt);
  if (days <= 0) return <span className="days out">{t.lineEndedShort}</span>;
  if (days <= EXPIRING_DAYS) return <span className="days soon">{t.expiringSoon} · <span className="num">{days}</span> {t.dayUnit}</span>;
  return <span className="days"><span className="num">{days}</span> {t.dayUnit}</span>;
}

const NO_PACKAGES: PackageRow[] = [];
const NO_COMPANIES: Shelf['companies'] = [];

export function LineCardScreen() {
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
  const [addonId, setAddonId] = useState('');
  const [ending, setEnding] = useState<LineRow | null>(null);
  const [switchTo, setSwitchTo] = useState('');
  const [nextIccid, setNextIccid] = useState('');
  const [nextEsim, setNextEsim] = useState(false);
  const [nextQr, setNextQr] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  const [posLoginName, setPosLoginName] = useState('');
  // What happens to the number's renewal price when it moves. Empty until chosen: there is no default.
  const [linePrices, setLinePrices] = useState<'' | TransferLinePrices>('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const verdict: Outcome = isPos ? 'success' : outcome;

  // Three reads, each cached on its own (ADR 0001): the number, the catalog (shared with the numbers list) and the
  // accounts (shared with the users page). An action on the number asks for the number again, not the other two.
  // `fresh`: the answer carries the eSIM code, so it is not kept in the shared cache once this page closes.
  const numberRead = useApiQuery(sharedKeys.line(params.id), () => api.officeLine(params.id), { fresh: true });
  const catalogRead = useApiQuery(sharedKeys.packages, () => api.officePackages());
  const usersRead = useApiQuery(sharedKeys.users, everyAccount, { enabled: canTransfer });
  const card = {
    loaded: numberRead.loaded && catalogRead.loaded && (!canTransfer || usersRead.loaded),
    // The catalog and the accounts are helpers: without them the card still shows, with fewer choices.
    error: numberRead.error,
    reload: numberRead.reload,
  };
  const line = numberRead.data?.line ?? null;
  useCrumbs({ [`/numbers/${encodeURIComponent(params.id)}`]: line?.msisdn });
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
    setPosLoginName('');
    setLinePrices('');
  }, []);

  const names: Record<Tab, string> = { ops: t.lineOps, details: t.lineDetails, log: t.lineLog };
  const items = line ? lineActions(line, verdict, run, t, { freeze: true, onDisconnect: setEnding }) : [];
  const opTexts: Record<string, string> = {
    [t.extend]: t.opTextExtend,
    [t.updateNumber]: t.opTextRefresh,
    [t.actCharge]: t.opTextCharge,
    [t.freeze]: t.opTextFreeze,
    [t.unfreeze]: t.opTextUnfreeze,
    [t.disconnect]: t.opTextDisconnect,
  };
  const opText = (label: string) => opTexts[label] ?? '';
  usePageTitle(line ? line.msisdn : t.lineCard);
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
  const simRules = line?.sim ?? OPEN_SIM;
  const simLabel = (row: LineRow) => (row.iccid ? <bdi dir="ltr">{row.iccid}</bdi> : row.esim ? t.esim : '—');

  return (
    <Desk
      title={line ? (
        <span className="line-hero-title">
          <bdi dir="ltr" className="line-number">{line.msisdn}</bdi>
          <Badge variant={lineTone(line.suspended ? 'suspended' : line.status)} dot>{lineStatus(t, line.suspended ? 'suspended' : line.status)}</Badge>
          {line.status === 'active' ? <LeftDays endsAt={line.endsAt} /> : null}
        </span>
      ) : t.lineCard}
      // Every operation is in the «العمليات» grid below, once (spec 2026-11-11-ui-consistency-pass, D4).
      lede="" error={error || card.error} note={note}>
      <div className="stack">
        {!card.loaded ? (
          <section className="pane">
            <header className="pane-head" />
            <TableSkeleton rows={4} columns={2} />
          </section>
        ) : line && (
          <>
            {/* The number's head, as in the approved design: status and what is left beside it, then where it lives. */}
            <header className="line-hero">
              <p className="lede">
                {[line.companyName, line.packageName].filter(Boolean).join(' · ')}
                {!isPos && line.posLoginName ? (
                  <> · {t.pointOfSale} <Link className="line-pos" href={`/users/${encodeURIComponent(line.posLoginName)}`}><AccountName login={line.posLoginName} /></Link></>
                ) : null}
              </p>
            </header>
          <Tabs items={tabs.map((item) => ({ key: item, label: names[item], count: item === 'log' && history.length ? history.length : undefined }))} value={tab} onChange={setTab} />
          <section className="pane line-pane">
            {tab === 'ops' && (
              <div className="pane-body line-ops">
                {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
                <div className="line-op-grid">
                  {items.map((item) => (
                    <LineOp key={item.label} icon={tileIcon(item)} title={item.label} text={opText(item.label)} danger={item.danger} now onClick={item.onClick} />
                  ))}
                  {allows('sim', line.status === 'active' && !line.opsLocked) && (
                    <LineOp icon={<Smartphone {...glyph} />} title={t.swapSim} text={t.opTextSim} onClick={() => { setNextIccid(simRules.prefix); setDialog('sim'); }} />
                  )}
                  {allows('esim', false) && (
                    <LineOp icon={<QrCode {...glyph} />} title={t.requestEsim} text={t.opTextEsim} onClick={() => setDialog('esim')} />
                  )}
                  {/* The package's extra operations (spec 2026-11-09, 3): each opens a manual task. */}
                  {(line.addons?.length ?? 0) > 0 && (
                    <LineOp icon={<PlusCircle {...glyph} />} title={t.lineAddons} text={t.opTextAddons} onClick={() => { setAddonId(line.addons?.[0]?.id ?? ''); setDialog('addon'); }} />
                  )}
                  {allows('rename', line.status === 'active' && !line.opsLocked) && (
                    <LineOp icon={<Hash {...glyph} />} title={t.changeNumber} text={t.opTextRename} onClick={() => setDialog('rename')} />
                  )}
                  {allows('switch', line.status === 'active' || Boolean(line.opsLocked)) && (
                    <LineOp icon={<Layers {...glyph} />} title={t.actSwitch} text={t.opTextSwitch} onClick={() => setDialog('switch')} />
                  )}
                  {canTransfer && (
                    <LineOp icon={<ArrowRightLeft {...glyph} />} title={t.transfer} text={t.opTextTransfer} onClick={() => setDialog('transfer')} />
                  )}
                </div>
              </div>
            )}
            {tab === 'details' && <LineDetails line={line} isPos={isPos} onQr={() => setDialog('qr')} />}
            {tab === 'log' && <DataTable columns={logColumns} rows={history} rowKey={(row) => row.id} empty={t.noHistory} />}
          </section>
          </>
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
              <Facts>
                <Fact label={t.currentSim}>{simLabel(line)}</Fact>
              </Facts>
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
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
                <Fact label={t.currentSim}>{simLabel(line)}</Fact>
                <Fact label={t.esimPrice}><Money value={line.esimPrice ?? 0} /></Fact>
              </Facts>
              <p className="hint">{t.requestEsimHint.replace('{price}', formatShekel(line.esimPrice ?? 0))}</p>
            </div>
          </Dialog>
          <Dialog
            open={dialog === 'addon'}
            title={t.lineAddons}
            closeLabel={t.closeMenu}
            onClose={closeDialog}
            size="confirm"
            mark="plus"
            footer={(
              <>
                <Button type="button" variant="secondary" onClick={closeDialog}>{t.cancel}</Button>
                <Button
                  type="button"
                  disabled={busy || !addonId}
                  onClick={() => act(() => api.requestAddon(line.id, addonId), { note: (data) => applyNote(t, data), then: closeDialog })}
                >
                  {t.requestAddon}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <fieldset className="addon-choices">
                <legend className="sr-only">{t.lineAddons}</legend>
                {(line.addons ?? []).map((addon) => (
                  <label key={addon.id} className="check">
                    <input type="radio" name="addon" checked={addonId === addon.id} onChange={() => setAddonId(addon.id)} />
                    <span>{addon.name}</span>
                    <Money value={addon.price} />
                  </label>
                ))}
              </fieldset>
              <p className="hint">{t.requestAddonHint}</p>
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
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
              </Facts>
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
                  disabled={busy || !posLoginName || !linePrices}
                  onClick={() => {
                    if (linePrices) void act(() => api.transferLine(line.id, posLoginName, linePrices), { note: t.transfer, then: closeDialog });
                  }}
                >
                  {t.transfer}
                </Button>
              </>
            )}
          >
            <div className="stack">
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
                <Fact label={t.pointOfSale}><AccountName login={line.posLoginName} /></Fact>
              </Facts>
              <label>
                {t.transfer}
                <NameField
                  value={posLoginName}
                  onChange={setPosLoginName}
                  options={posChoices.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), keys: [row.loginName] }))}
                />
              </label>
              <LineChoice value={linePrices} onChange={setLinePrices} />
            </div>
          </Dialog>
        </>
      )}
    </Desk>
  );
}
