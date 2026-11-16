'use client';

import { ArrowRightLeft, CalendarPlus, ChevronLeft, Hash, Layers, PhoneOff, PlusCircle, QrCode, RefreshCw, Smartphone, Snowflake, Sun, Zap } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Money, OutcomePick, Pane, actionName, applyNote, latinWhen, lineStatus } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { DisconnectConfirm } from '../../../components/disconnect-confirm';
import { EsimDialog, QrPicker } from '../../../components/esim-qr';
import { lineActions, type RunLine } from '../../../components/line-actions';
import { TableSkeleton } from '../../../components/loading';
import type { RowAction } from '../../../components/row-menu';
import { LineChoice } from '../../../components/transfer-dialog';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group';
import { figureCardClass, riseInClass } from '../../../components/stat';
import { api, type LineHistory, type LineRow, type Outcome, type PackageRow, type Shelf, type TransferLinePrices } from '../../../lib/api';
import { everyAccount } from '../../../lib/directory';
import { cn } from '../../../lib/cn';
import { useDoor } from '../../../lib/door-context';
import { useDesk } from '../../../lib/desk-session';
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
import { Days } from '../days';

// «التفاصيل» second, as key and value rows; no fact cards above the tabs (owner, 2026-11-11).
const tabs = ['ops', 'details', 'log'] as const;
type Tab = (typeof tabs)[number];
type DialogName = 'sim' | 'esim' | 'rename' | 'switch' | 'transfer' | 'qr' | 'addon' | null;

const glyph = { size: 18, strokeWidth: 1.9, 'aria-hidden': true as const };

/*
 * The look (Tailwind migration T4.5, ADR 0022), ported from desk/pane.css, desk/numbers.css, desk/packages.css,
 * dialog.css, responsive.css and graphite.css («Number card») in their cascade order:
 * - the column: the desk's stack (12px apart, its own height); it keeps the `stack` class as the handle the desk
 *   column, the canvas and `Pane` size by;
 * - the title: the number 26px bold, spaced 0.02em, tabular, then its status badge (13px) and what is left (13px),
 *   12px apart, wrapping; the head under it is pulled 8px up, one line of 13px `--rd-muted`; its point of sale link
 *   600 `--rd-accent`, underlined under the pointer, 40px high under 641px;
 * - the tabs' pane is bare: no fill, no edge, nothing clipped; a table in it sits in its sheet on `--rd-surface` with
 *   6px corners and a 1px inset `--rd-line` edge (the pane keeps the frame shadow and 8px corners of a pane that holds
 *   a table);
 * - the operations tab: a column 12px apart with no padding that scrolls inside the pane; the outcome pick as wide as
 *   its content; the cards as many 230px-or-wider columns as fit, 12px apart (two columns 10px apart under 641px),
 *   rising in one after another;
 * - an operation card (`figureCardClass`: 6px corners, a 1px inset `--rd-line` edge, the cut corner, the light under
 *   the pointer, the 2px lift): a column 6px apart at the reading start, 18px padding (14px under 641px) on
 *   `--rd-surface`, ink; a 2px inset `--rd-accent` ring on keyboard focus, drawn inside the cut; 45% when disabled;
 *   its mark 36px, 6px corners, `--rd-accent` on `--rd-accent-soft` (`--rd-danger` on `--rd-danger-soft` for a danger
 *   operation); the name 14.5px bold (`--rd-danger` for danger); one line 12px `--rd-muted`; the chevron 18px from the
 *   top and 16px from the reading end in `--rd-faint`, which turns `--rd-accent` and slides 4px forward under the
 *   pointer (hidden under 641px);
 * - the dialogs: a column 12px apart; fields are dialog labels and fields; a field's hint 12px 500; the eSIM box and an
 *   extra operation in a row 8px from its name, at least 36px high (44px at 720px and under), 13px ink 600; the extra
 *   operations one per row, the box, the name and the price, 6px above and below a 1px `--rd-line-soft` rule, 4px
 *   apart; a dialog's note a plain paragraph (no legacy rule reached a `.hint` paragraph in a dialog's body);
 * - the package picks: as many 8.5rem-or-wider columns as fit, 8px apart; a pick at least 132px high, a centred column
 *   6px apart with 14px / 10px padding, a 1px `--rd-line` border with 6px corners on `--rd-surface`, ink; the chosen
 *   one an ink border on `--rd-surface-2`; its mark 48px, 8px corners, on `--rd-surface-2` (a picture contained, a
 *   letter 800).
 */
const COLUMN = 'stack flex min-h-auto min-w-0 max-w-full flex-none flex-col gap-3 overflow-visible *:min-w-0';
const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
const LINE_PANE = cn(
  'overflow-visible bg-transparent inset-ring-0',
  '[&_[data-slot=table-sheet]]:rounded-sm [&_[data-slot=table-sheet]]:bg-surface [&_[data-slot=table-sheet]]:inset-ring [&_[data-slot=table-sheet]]:inset-ring-line',
);
const OPS = cn(
  'grid min-h-0 content-start gap-3 overflow-auto p-0 *:min-w-0',
  '[&>[data-slot=outcome-pick]]:w-max [&>[data-slot=outcome-pick]]:max-w-full [&>[data-slot=outcome-pick]]:justify-items-start',
);
const OP_GRID = cn('grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 max-sm:grid-cols-2 max-sm:gap-2.5', riseInClass);
const LINE_OP = cn(
  figureCardClass,
  'group grid justify-items-start gap-1.5 bg-surface p-4.5 text-start text-ink max-sm:p-3.5 disabled:opacity-45',
  'focus-visible:outline-none',
  "focus-visible:before:pointer-events-none focus-visible:before:absolute focus-visible:before:inset-0 focus-visible:before:z-1 focus-visible:before:rounded-[inherit] focus-visible:before:inset-ring-2 focus-visible:before:inset-ring-accent focus-visible:before:content-['']",
);
const LINE_OP_GO = cn(
  'absolute top-4.5 end-4 text-faint [transition:transform_220ms_var(--rd-ease-out),color_var(--rd-dur-fast)_var(--rd-ease-standard)] max-sm:hidden',
  'ltr:[transform:scaleX(-1)] group-hover:text-accent',
  'rtl:group-hover:[transform:translateX(-4px)] ltr:group-hover:[transform:scaleX(-1)_translateX(-4px)]',
);
const DIALOG_COLUMN = 'grid content-start gap-3 *:min-w-0';
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center gap-2 text-ink max-touch:min-h-11';
const FIELD_HINT = 'text-sm font-medium';
const PACK_PICK = cn(
  'grid min-h-33 justify-items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-3.5 text-center text-ink',
  '[&>img]:size-12 [&>img]:rounded-card [&>img]:bg-surface-2 [&>img]:object-contain',
);

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
  // `now`: an immediate operation (lineActions), as opposed to one that opens a form. `data-slot="line-op"`: the shell
  // finds the card by it to move its light under the pointer.
  return (
    <button type="button" className={LINE_OP} data-slot="line-op" data-testid="line-op" data-now={now ? '' : undefined} aria-label={title} onClick={onClick}>
      <span className={cn('grid size-9 place-items-center rounded-sm', danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>{icon}</span>
      <b className={cn('text-item font-bold', danger && 'text-danger')}>{title}</b>
      <span className="text-sm text-muted">{text}</span>
      <ChevronLeft className={LINE_OP_GO} size={16} aria-hidden="true" />
    </button>
  );
}

/** What is left on an active number: crimson and worded when it ends soon. */
function LeftDays({ endsAt }: { endsAt: string }) {
  const { t } = usePrefs();
  const days = daysLeft(endsAt);
  if (days <= 0) return <Days tone="out" className="text-md">{t.lineEndedShort}</Days>;
  if (days <= EXPIRING_DAYS) return <Days tone="soon" className="text-md">{t.expiringSoon} · <span>{days}</span> {t.dayUnit}</Days>;
  return <Days tone="left" className="text-md"><span>{days}</span> {t.dayUnit}</Days>;
}

const NO_PACKAGES: PackageRow[] = [];
const NO_COMPANIES: Shelf['companies'] = [];

export function LineCardScreen() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const door = useDoor();
  const { me } = useDesk();
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
  const addonLegend = useId();
  const verdict: Outcome = isPos ? 'success' : outcome;

  // Three reads, each cached on its own (ADR 0001): the number, the catalog (shared with the numbers list) and the
  // accounts (shared with the users page). An action on the number asks for the number again, not the other two.
  // `fresh`: the answer carries the eSIM code, so it is not kept in the shared cache once this page closes.
  const numberRead = useApiQuery(sharedKeys.line(params.id), () => api.line(params.id), { fresh: true });
  const catalogRead = useApiQuery(sharedKeys.packages, () => api.packages());
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
    { key: 'when', header: t.when, kind: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
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
        <span className="inline-flex flex-wrap items-center gap-3">
          <bdi dir="ltr" className="m-0 text-6xl font-bold tracking-head tabular-nums" data-testid="line-number">{line.msisdn}</bdi>
          {/* 13px beside the number (the legacy `.line-hero-title .ui-badge` rule). */}
          <Badge className="text-md" variant={lineTone(line.suspended ? 'suspended' : line.status)} dot>{lineStatus(t, line.suspended ? 'suspended' : line.status)}</Badge>
          {line.status === 'active' ? <LeftDays endsAt={line.endsAt} /> : null}
        </span>
      ) : t.lineCard}
      // Every operation is in the «العمليات» grid below, once (spec 2026-11-11-ui-consistency-pass, D4).
      lede="" error={error || card.error} note={note}>
      <div className={COLUMN}>
        {!card.loaded ? (
          <Pane>
            <header className={PANE_HEAD} />
            <TableSkeleton rows={4} columns={2} />
          </Pane>
        ) : line && (
          <>
            {/* The number's head, as in the approved design: status and what is left beside it, then where it lives. */}
            <header className="-mt-2">
              <p className="m-0 text-md text-muted">
                {[line.companyName, line.packageName].filter(Boolean).join(' · ')}
                {!isPos && line.posLoginName ? (
                  <> · {t.pointOfSale} <Link className="font-semibold text-accent no-underline hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center" href={`/users/${encodeURIComponent(line.posLoginName)}`}><AccountName login={line.posLoginName} /></Link></>
                ) : null}
              </p>
            </header>
          <Tabs items={tabs.map((item) => ({ key: item, label: names[item], count: item === 'log' && history.length ? history.length : undefined }))} value={tab} onChange={setTab} />
          <Pane className={LINE_PANE} data-testid="line-pane">
            {tab === 'ops' && (
              <div className={OPS} data-testid="line-ops">
                {!isPos && <OutcomePick value={outcome} onChange={setOutcome} />}
                <div className={OP_GRID} data-testid="line-op-grid">
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
          </Pane>
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
            <div className={DIALOG_COLUMN}>
              <Facts>
                <Fact label={t.currentSim}>{simLabel(line)}</Fact>
              </Facts>
              <Label tone="dialog">
                {t.newSim}
                <Input value={nextIccid} inputMode="numeric" dir="ltr" onChange={(event) => setNextIccid(event.target.value)} />
                {hasSimRules(simRules) && <span className={FIELD_HINT}>{simHint(t, simRules)}</span>}
              </Label>
              {simRules.esim && (
                <Label className={CHECK_ROW}>
                  <Checkbox checked={nextEsim} onCheckedChange={(next) => setNextEsim(next === true)} />
                  {t.esim}
                </Label>
              )}
              {nextEsim && (
                <div className={DIALOG_COLUMN}>
                  <span>{t.qrImage}</span>
                  <QrPicker value={nextQr} onChange={setNextQr} disabled={busy} />
                </div>
              )}
              <p>{t.swapEsimHint}</p>
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
            <div className={DIALOG_COLUMN}>
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
                <Fact label={t.currentSim}>{simLabel(line)}</Fact>
                <Fact label={t.esimPrice}><Money value={line.esimPrice ?? 0} /></Fact>
              </Facts>
              <p>{t.requestEsimHint.replace('{price}', formatShekel(line.esimPrice ?? 0))}</p>
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
            <div className={DIALOG_COLUMN}>
              <fieldset className="m-0 border-0 p-0">
                <legend id={addonLegend} className="sr-only">{t.lineAddons}</legend>
                <RadioGroup className="grid gap-1" value={addonId} onValueChange={setAddonId} aria-labelledby={addonLegend}>
                  {(line.addons ?? []).map((addon) => (
                    <label
                      key={addon.id}
                      className="m-0 grid min-h-9 cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-line-soft py-1.5 text-md font-semibold text-ink max-touch:min-h-11"
                    >
                      <RadioGroupItem value={addon.id} />
                      <span>{addon.name}</span>
                      <Money value={addon.price} />
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
              <p>{t.requestAddonHint}</p>
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
            <div className={DIALOG_COLUMN}>
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
              </Facts>
              <Label tone="dialog">
                {t.newNumber}
                <Input value={nextNumber} inputMode="numeric" dir="ltr" onChange={(event) => setNextNumber(event.target.value)} />
                <span className={FIELD_HINT}>{t.newNumberLater}</span>
              </Label>
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
              <p>{t.noSwitchTargets}</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
                {switchChoices.map((row) => {
                  const image = companies.find((company) => company.name === row.companyName)?.image;
                  return (
                    <button
                      key={row.code}
                      type="button"
                      className={cn(PACK_PICK, switchTo === row.code && 'border-ink bg-surface-2')}
                      data-slot="pack-pick"
                      onClick={() => setSwitchTo(row.code)}
                    >
                      {image ? (
                        <DataImage src={image} alt="" />
                      ) : (
                        <span className="grid size-12 place-items-center rounded-card bg-surface-2 font-bold">{row.companyName.slice(0, 1)}</span>
                      )}
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
            <div className={DIALOG_COLUMN}>
              <Facts>
                <Fact label={t.number}><bdi dir="ltr">{line.msisdn}</bdi></Fact>
                <Fact label={t.pointOfSale}><AccountName login={line.posLoginName} /></Fact>
              </Facts>
              <Label tone="dialog">
                {t.transfer}
                <NameField
                  value={posLoginName}
                  onChange={setPosLoginName}
                  options={posChoices.map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), keys: [row.loginName] }))}
                />
              </Label>
              <LineChoice value={linePrices} onChange={setLinePrices} />
            </div>
          </Dialog>
        </>
      )}
    </Desk>
  );
}
