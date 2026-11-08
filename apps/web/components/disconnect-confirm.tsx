'use client';

import { useEffect, useState } from 'react';
import { api, type DisconnectQuote, type LineRow } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { Money } from './desk';
import { Dialog } from './dialog';
import { Button } from './ui/button';

/**
 * Asks before a disconnect and shows what the point of sale gets back, by the same rule the
 * disconnect uses. `line` null keeps it closed. `failing` is the branch's provider outcome.
 */
export function DisconnectConfirm({
  line,
  busy,
  failing = false,
  onClose,
  onConfirm,
}: {
  line: LineRow | null;
  busy: boolean;
  failing?: boolean;
  onClose: () => void;
  onConfirm: (line: LineRow) => Promise<unknown>;
}) {
  const { t, apiText } = usePrefs();
  const [answer, setAnswer] = useState<{ id: string; quote: DisconnectQuote | null; error: string } | null>(null);
  const id = line?.id ?? '';
  const current = answer && answer.id === id ? answer : null;
  const quote = current?.quote ?? null;
  const error = current?.error ?? '';

  useEffect(() => {
    if (!id) return;
    let live = true;
    void api.disconnectQuote(id).then((result) => {
      if (!live) return;
      setAnswer(result.ok ? { id, quote: result.data, error: '' } : { id, quote: null, error: apiText(result) });
    });
    return () => {
      live = false;
    };
  }, [id, apiText]);

  const finish = () => {
    setAnswer(null);
    onClose();
  };
  const close = () => {
    if (!busy) finish();
  };

  return (
    <Dialog
      open={Boolean(line)}
      size="confirm"
      title={t.disconnectTitle}
      lede={t.disconnectHint}
      mark="alert"
      tone="danger"
      closeLabel={t.closeMenu}
      error={error}
      onClose={close}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t.cancel}</Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy || !quote}
            onClick={async () => {
              if (!line) return;
              await onConfirm(line);
              finish();
            }}
          >
            {t.disconnect}
          </Button>
        </>
      )}
    >
      {line ? (
        <div className="stack">
          <dl className="detail-rows">
            <div><dt>{t.number}</dt><dd><bdi dir="ltr">{line.msisdn}</bdi></dd></div>
            <div>
              <dt>{quote && quote.amount < 0 ? t.disconnectTakes : t.disconnectReturns}</dt>
              <dd>{quote ? <Money value={Math.abs(quote.amount)} /> : t.loading}</dd>
            </div>
          </dl>
          {quote && (failing || !quote.runsNow) ? <p className="hint">{t.disconnectAsTask}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
