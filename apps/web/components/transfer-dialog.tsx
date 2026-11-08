'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { Select } from './ui/select';
import { badgeClass } from '../lib/status-tone';

type Props = {
  open: boolean;
  /** The point of sale or agent that moves. */
  row: UserRow | null;
  /** The accounts it may move under, already limited to the right layer and without its current parent. */
  destinations: UserRow[];
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
function requestOf(kind: Kind, parentLogin: string, choice: Choices): TransferAccountBody | null {
  const { ownPrices, ownStops, linePrices } = choice;
  if (!parentLogin || !ownPrices || !ownStops || !linePrices) return null;
  if (kind === 'pos') return { parentLogin, ownPrices, ownStops, linePrices };
  const { childPrices, childStops } = choice;
  if (!childPrices || !childStops) return null;
  return { parentLogin, ownPrices, ownStops, childPrices, childStops, linePrices };
}

type Option<T extends string> = { value: T; label: string };

/** The radios of one question, each a `label.check`. They share a `name`, so the arrow keys stay inside the question. */
function Radios<T extends string>({
  name,
  value,
  options,
  onPick,
}: {
  name: string;
  value: '' | T;
  options: Option<T>[];
  onPick: (value: T) => void;
}) {
  return (
    <div className="choice-options">
      {options.map((option) => (
        <label key={option.value} className="check">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onPick(option.value)} />
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
    <div className="choice-row" role="radiogroup" aria-labelledby={`${id}-name`}>
      <span id={`${id}-name`} className="choice-name">{label}</span>
      <Radios name={id} value={value} options={options} onPick={onPick} />
    </div>
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
    <fieldset className="choice-set">
      <legend>{legend}</legend>
      <ChoiceRow label={t.transferPricesRow} value={prices} options={options} onPick={onPrices} />
      <ChoiceRow label={t.transferStopsRow} value={stops} options={options} onPick={onStops} />
    </fieldset>
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
    <fieldset className="choice-set">
      <legend>{t.transferLinesRow}</legend>
      <div className="choice-row">
        {count === undefined ? null : <span className="choice-name">{t.transferLinesCount.replace('{n}', String(count))}</span>}
        <Radios name={id} value={value} options={options} onPick={onChange} />
      </div>
    </fieldset>
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
      className="dialog-transfer"
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
      <div className="dialog-form">
        <p className="dialog-who"><AccountName login={row.loginName} name={row.nickname} /></p>
        <label>
          {kind === 'pos' ? t.transferDestinationAgent : t.transferDestinationMain}
          <Select value={parent} disabled={busy} onChange={(event) => choose(event.target.value)}>
            <option value="">—</option>
            {destinations.map((item) => (
              <option key={item.loginName} value={item.loginName}>{accountLabel(item.loginName, item.nickname)}</option>
            ))}
          </Select>
        </label>
        {loading ? (
          <div role="status" aria-label={t.loading}>
            <TableSkeleton rows={3} columns={2} />
          </div>
        ) : null}
        {preview ? (
          <>
            <div className="transfer-terms">
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
            <dl className="detail-rows">
              <div><dt>{t.transferBalance}</dt><dd><Money value={preview.balance} /></dd></div>
              {kind === 'agent' ? <div><dt>{t.transferSubtreeBalance}</dt><dd><Money value={preview.subtreeBalance} /></dd></div> : null}
            </dl>
            {preview.own.belowNewFloor > 0 ? (
              <div>
                <span className={badgeClass('warning')}>{t.transferBelowFloor.replace('{n}', String(preview.own.belowNewFloor))}</span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
