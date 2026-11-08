'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LinePriceChange } from '../lib/api';
import { formatShekel, parseShekel } from '../lib/money';
import { usePrefs } from '../lib/prefs';
import { useAction } from '../lib/use-action';
import { useApiQuery } from '../lib/use-api-query';
import { packageKeys } from '../lib/query';
import { Money } from './desk';
import { Dialog } from './dialog';
import { EmptyState } from './empty-state';
import { LoadFailed } from './load-failed';
import { TableSkeleton } from './loading';
import { PriceField } from './price-field';
import { Button } from './ui/button';

type Props = {
  open: boolean;
  code: string;
  packageName: string;
  /** A login (that account and everything under it) or `all` (the whole system, branch only). */
  scope: string;
  onClose: () => void;
  /** Runs once the save went through, with the number of numbers it repriced. */
  onSaved: (lines: number) => void;
};

// A group's new price: a flat price in agorot, or `'current'` to follow what a new activation carries.
type Draft = number | 'current';

// The write reports to the caller through `onSaved`; the dialog keeps no note of its own.
const noNote = () => {};

/**
 * The renewable numbers of one package in a scope, grouped by the renewal price each one carries.
 * The operator types a new price per group, or fills every group with "follow the current price".
 * Nothing is written until the footer save. Used by the user page, and by the package sheet.
 */
export function LinePricesDialog(props: Props) {
  // Mounted only while open, so each opening reads its own table and starts without drafts: a table
  // loaded for another package or scope, or one just saved, never shows through.
  return props.open ? <LinePricesTable {...props} /> : null;
}

function LinePricesTable({ code, packageName, scope, onClose, onSaved }: Props) {
  const { t, apiText } = usePrefs();
  const [drafts, setDrafts] = useState<Partial<Record<number, Draft>>>({});
  const [error, setError] = useState('');
  // A refused text is not a draft, so the table looks unchanged while its message is on screen. This flag stands for
  // that message until a price is accepted or "follow" is used; a failed save also sets `error`, but is no refusal.
  const [refused, setRefused] = useState(false);
  const table = useApiQuery(packageKeys.linePrices(code, scope), () => api.linePrices(code, scope), { fresh: true });
  const { run, busy } = useAction({ setError, setNote: noNote });

  // `Dialog` focuses its first field again whenever `onClose` changes, so the handler it gets stays the
  // same while the table is edited. It also holds still while a save is in flight, so the page hears about it.
  const latest = useRef({ onClose, busy });
  useEffect(() => {
    latest.current = { onClose, busy };
  });
  const close = useCallback(() => {
    if (!latest.current.busy) latest.current.onClose();
  }, []);

  const groups = table.data?.groups ?? [];
  const current = table.data?.current ?? null;
  // A flat price equal to what the group already carries changes nothing, so it is not a change.
  const changes: LinePriceChange[] = groups.flatMap((group) => {
    const to = drafts[group.price];
    return to === undefined || to === group.price ? [] : [{ from: group.price, to }];
  });

  // An empty field puts the group back to "unchanged"; a text that is not a price is refused here, not at save.
  function setDraft(price: number, text: string) {
    const to = text === '' ? null : parseShekel(text);
    if (text !== '' && to === null) {
      setError(apiText('بيانات غير صالحة'));
      setRefused(true);
      return;
    }
    setError('');
    setRefused(false);
    setDrafts((now) => {
      const next = { ...now };
      if (to === null) delete next[price];
      else next[price] = to;
      return next;
    });
  }

  function follow() {
    setError('');
    setRefused(false);
    setDrafts(Object.fromEntries(groups.map((group) => [group.price, 'current' as const])));
  }

  // Save is never held back by the drafts. A disabled button swallows the mousedown, so a field still being typed
  // in would not blur and commit; an enabled one blurs the field first, the draft lands, and the same click saves.
  function save() {
    // A refused price is on screen: save neither sends around it nor closes over it. Cancel and Escape still close.
    // It keys on the refusal, not on `error`: after a failed save `error` is set too, and save must stay a retry.
    if (refused) return;
    // Nothing differs from what the groups already carry, so there is nothing to send.
    if (changes.length === 0) {
      onClose();
      return;
    }
    void run(() => api.setLinePrices(code, scope, changes), {
      reload: false,
      then: (data) => {
        onSaved(data.lines);
        onClose();
      },
    });
  }

  return (
    <Dialog
      open
      size="form"
      title={t.linePricesTitle.replace('{name}', packageName)}
      closeLabel={t.closeMenu}
      error={error}
      onClose={close}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t.cancel}</Button>
          <Button type="button" disabled={busy || !table.loaded} onClick={save}>{t.save}</Button>
        </>
      )}
    >
      {!table.loaded ? (
        <TableSkeleton rows={3} columns={3} />
      ) : !table.data ? (
        <LoadFailed message={table.error} onRetry={() => void table.reload()} />
      ) : groups.length === 0 ? (
        <EmptyState icon="numbers">{t.linePricesEmpty}</EmptyState>
      ) : (
        <div className="dialog-form">
          <div>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={follow}>
              {current === null ? t.linePricesFollowChain : t.linePricesFollow.replace('{price}', formatShekel(current))}
            </Button>
          </div>
          <section className="pane">
            <div className="sheet">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">{t.linePricesCurrent}</th>
                    <th className="num">{t.linePricesCount}</th>
                    <th className="num">{t.linePricesNew}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const draft = drafts[group.price];
                    return (
                      <tr key={group.price}>
                        <td className="num"><Money value={group.price} /></td>
                        <td className="num">{group.count}</td>
                        <td className="num">
                          <span className="price-pair">
                            <PriceField
                              label={`${formatShekel(group.price)} ${t.linePricesNew}`}
                              value={typeof draft === 'number' ? draft : null}
                              placeholder={current ?? group.price}
                              disabled={busy}
                              onSave={(text) => setDraft(group.price, text)}
                            />
                            {draft === 'current' ? <span className="hint">{t.linePricesFollowShort}</span> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
