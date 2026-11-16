'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type TransferAccountBody,
  type TransferLinePrices,
  type TransferPreview,
  type TransferReset,
  type UserRow,
} from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { useAction } from '../lib/use-action';
import { AccountName, accountLabel } from './account-name';
import { Money } from './desk';
import { Dialog } from './dialog';
import { TableSkeleton } from './loading';
import { Button } from './ui/button';
import { NameField } from './name-field';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Fact, Facts } from './facts';

type Props = {
  open: boolean;
  /** The point of sale or agent that moves. */
  row: UserRow | null;
  /** The accounts it may move under, already limited to the right layer and without its current parent. */
  destinations: Pick<UserRow, 'loginName' | 'nickname'>[];
  onClose: () => void;
  /** Runs once the move went through; the page closes the dialog and reads its list again. */
  onDone: () => void;
};

type Kind = 'pos' | 'agent';

// Every choice starts empty and stays empty until the person makes it: the move has no default to fall back on.
type Choices = {
  ownPrices: '' | TransferReset;
  ownStops: '' | TransferReset;
  childPrices: '' | TransferReset;
  childStops: '' | TransferReset;
  linePrices: '' | TransferLinePrices;
};
const NOTHING: Choices = { ownPrices: '', ownStops: '', childPrices: '', childStops: '', linePrices: '' };

// What `GET transfer-preview` said for one destination: what the move carries, or why it is refused.
type Answer = { parent: string; preview: TransferPreview | null; message: string; code?: string };

// `useAction` wants a place for a success note. A move says nothing: the dialog closes and the list changes.
const noNote = () => {};

/** The request, or null while the destination or a choice the move needs is still missing. A point of sale has no child terms. */
function requestOf(kind: Kind, parentLoginName: string, choice: Choices): TransferAccountBody | null {
  const { ownPrices, ownStops, linePrices } = choice;
  if (!parentLoginName || !ownPrices || !ownStops || !linePrices) return null;
  if (kind === 'pos') return { parentLoginName, ownPrices, ownStops, linePrices };
  const { childPrices, childStops } = choice;
  if (!childPrices || !childStops) return null;
  return { parentLoginName, ownPrices, ownStops, childPrices, childStops, linePrices };
}

type Option<T extends string> = { value: T; label: string };

/*
 * Choices with no default (this dialog and the number card), ported from the legacy dialog.css rules (`.choice-*`,
 * `.check` in pane.css, responsive.css): a group is a fieldset of rows (14px at the sides, 2px above and 6px below,
 * a 1px `--rd-line` border with 6px corners; its legend 12px bold ink, 6px at its sides, pulled 6px towards the
 * reading start); a row is a Radix RadioGroup (`role="radiogroup"`, the arrow keys move inside it) holding its name
 * (a 9.5rem column in 12px semibold `--rd-ink-2`) and its radios, 16px apart, on one line while the group is wide
 * enough, then the radios wrap under the name. Each radio sits in its 44px label (13px semibold ink, 8px from the
 * box), which names it and takes its clicks.
 */
const rowClass = 'flex flex-wrap items-center gap-x-4';
const nameClass = 'shrink-0 basis-38 text-sm font-semibold text-ink-2';

/** The radios of one question, each in its label. */
function Radios<T extends string>({ options }: { options: Option<T>[] }) {
  return (
    <div className="flex flex-wrap gap-x-4">
      {options.map((option) => (
        <label
          key={option.value}
          className="m-0 flex min-h-11 cursor-pointer items-center gap-2 text-start text-md font-semibold text-ink"
          data-testid="radio-row"
        >
          <RadioGroupItem value={option.value} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** One question with its name and its two answers. The name labels the group for a screen reader. */
function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: '' | T;
  options: Option<T>[];
  onPick: (value: T) => void;
}) {
  const id = useId();
  return (
    <RadioGroup className={rowClass} value={value} onValueChange={(next) => onPick(next as T)} aria-labelledby={`${id}-name`}>
      <span id={`${id}-name`} className={nameClass}>{label}</span>
      <Radios options={options} />
    </RadioGroup>
  );
}

/** A group of questions: the fieldset and its legend. */
function ChoiceSet({ legend, legendId, children }: { legend: string; legendId?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 min-w-0 rounded-sm border border-line px-3.5 pt-0.5 pb-1.5">
      <legend id={legendId} className="-ms-1.5 px-1.5 text-sm font-bold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** The terms written on an account: its prices and hidden packages, and its stops. Each stays or follows the new chain. */
function TermsGroup({
  legend,
  prices,
  stops,
  onPrices,
  onStops,
}: {
  legend: string;
  prices: '' | TransferReset;
  stops: '' | TransferReset;
  onPrices: (value: TransferReset) => void;
  onStops: (value: TransferReset) => void;
}) {
  const { t } = usePrefs();
  const options: Option<TransferReset>[] = [
    { value: 'keep', label: t.transferKeep },
    { value: 'reset', label: t.transferFollow },
  ];
  return (
    <ChoiceSet legend={legend}>
      <ChoiceRow label={t.transferPricesRow} value={prices} options={options} onPick={onPrices} />
      <ChoiceRow label={t.transferStopsRow} value={stops} options={options} onPick={onStops} />
    </ChoiceSet>
  );
}

/**
 * What the renewal price of each moved number does: it stays, or it is worked out again under the new parent.
 * The account dialog asks it with the count of numbers the move carries; the number card asks it for one number.
 */
export function LineChoice({
  value,
  onChange,
  count,
}: {
  value: '' | TransferLinePrices;
  onChange: (value: TransferLinePrices) => void;
  count?: number;
}) {
  const { t } = usePrefs();
  const id = useId();
  const options: Option<TransferLinePrices>[] = [
    { value: 'keep', label: t.transferKeep },
    { value: 'recapture', label: t.transferRecapture },
  ];
  return (
    <ChoiceSet legend={t.transferLinesRow} legendId={`${id}-legend`}>
      {/* The one question of the group: its radios are named by the legend. */}
      <RadioGroup className={rowClass} value={value} onValueChange={(next) => onChange(next as TransferLinePrices)} aria-labelledby={`${id}-legend`}>
        {count === undefined ? null : <span className={nameClass}>{t.transferLinesCount.replace('{n}', String(count))}</span>}
        <Radios options={options} />
      </RadioGroup>
    </ChoiceSet>
  );
}

/**
 * Moves a point of sale, or an agent with everything under it, to another parent. The destination comes first;
 * the preview of that move answers what it carries, and only then are the choices asked, none of them filled in.
 */
export function TransferDialog(props: Props) {
  // Mounted only while open, so each opening starts with no destination, no preview and no choice made.
  const { open, row, destinations, onClose, onDone } = props;
  return open && row ? <TransferForm key={row.loginName} row={row} destinations={destinations} onClose={onClose} onDone={onDone} /> : null;
}

function TransferForm({ row, destinations, onClose, onDone }: Omit<Props, 'open' | 'row'> & { row: UserRow }) {
  const { t, apiText } = usePrefs();
  const kind: Kind = row.layer === 'pos' ? 'pos' : 'agent';
  const [parent, setParent] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [choice, setChoice] = useState<Choices>(NOTHING);
  const [error, setError] = useState('');
  const { run, busy } = useAction({ setError, setNote: noNote });

  // The preview of the destination now chosen. An answer that arrives after another destination was picked is
  // dropped, so the numbers on screen are always those of the destination in the select.
  useEffect(() => {
    if (!parent) return;
    let live = true;
    void api.transferPreview(row.loginName, parent).then((result) => {
      if (live) setAnswer({ parent, preview: result.ok ? result.data : null, message: result.ok ? '' : result.message, code: result.ok ? undefined : result.code });
    });
    return () => {
      live = false;
    };
  }, [row.loginName, parent]);

  // `Dialog` focuses its first field again whenever `onClose` changes, so the handler it gets never changes while
  // the radios are used. It also refuses to close while the move is in flight.
  const latest = useRef({ onClose, busy });
  useEffect(() => {
    latest.current = { onClose, busy };
  });
  const close = useCallback(() => {
    if (!latest.current.busy) latest.current.onClose();
  }, []);

  const current = answer?.parent === parent ? answer : null;
  const preview = current?.preview ?? null;
  // The server may refuse the destination now chosen; the person reads that before any choice is asked.
  const refusal = current && !current.preview ? apiText({ message: current.message, code: current.code }) : '';
  const loading = parent !== '' && current === null;
  const request = requestOf(kind, parent, choice);

  function choose(login: string) {
    setParent(login);
    setError('');
  }

  function set(patch: Partial<Choices>) {
    setChoice((now) => ({ ...now, ...patch }));
  }

  function move() {
    if (!request || !preview) return;
    void run(() => api.transferAccount(row.loginName, request), { then: onDone });
  }

  return (
    <Dialog
      open
      size="form"
      // A wide screen gives the move the room for the two groups of terms side by side.
      className="xl:w-[min(760px,100%)]"
      mark="transfer"
      title={t.transfer}
      closeLabel={t.closeMenu}
      error={error || refusal}
      onClose={close}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t.cancel}</Button>
          <Button type="button" disabled={busy || !request || !preview} onClick={move}>{t.transfer}</Button>
        </>
      )}
    >
      <div className="grid gap-3">
        <p className="m-0 text-base font-bold"><AccountName login={row.loginName} name={row.nickname} /></p>
        <Label tone="dialog">
          {kind === 'pos' ? t.transferDestinationAgent : t.transferDestinationMain}
          <NameField
            value={parent}
            disabled={busy}
            onChange={choose}
            options={destinations.map((item) => ({ value: item.loginName, label: accountLabel(item.loginName, item.nickname), keys: [item.loginName] }))}
          />
        </Label>
        {loading ? (
          <div role="status" aria-label={t.loading}>
            <TableSkeleton rows={3} columns={2} />
          </div>
        ) : null}
        {preview ? (
          <>
            {/* The two groups of terms share a row once each has room for its rows, and stack when it does not. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))] gap-3">
              <TermsGroup
                legend={t.transferOwnTerms}
                prices={choice.ownPrices}
                stops={choice.ownStops}
                onPrices={(value) => set({ ownPrices: value })}
                onStops={(value) => set({ ownStops: value })}
              />
              {kind === 'agent' ? (
                <TermsGroup
                  legend={t.transferChildTerms}
                  prices={choice.childPrices}
                  stops={choice.childStops}
                  onPrices={(value) => set({ childPrices: value })}
                  onStops={(value) => set({ childStops: value })}
                />
              ) : null}
            </div>
            <LineChoice value={choice.linePrices} count={preview.lines} onChange={(value) => set({ linePrices: value })} />
            <Facts>
              <Fact label={t.transferBalance}><Money value={preview.balance} /></Fact>
              {kind === 'agent' ? <Fact label={t.transferSubtreeBalance}><Money value={preview.subtreeBalance} /></Fact> : null}
            </Facts>
            {preview.own.belowNewFloor > 0 ? (
              <div>
                <Badge variant="warning" dot data-testid="transfer-floor">{t.transferBelowFloor.replace('{n}', String(preview.own.belowNewFloor))}</Badge>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
