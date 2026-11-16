'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { Icon } from './icon';
import { Button } from './ui/button';

/*
 * The look (Tailwind migration T3.3, ADR 0022), ported from desk/components.css with the `h1` element rule of
 * forms.css: the panel is a centred grid that fills the canvas, at most 28rem wide, 8px between its rows, 48px / 16px
 * padding, centred text; its mark a 56px round tile in `--rd-danger` on `--rd-danger-soft`, 8px over the title, the
 * glyph 1.6rem at a 1.8 stroke; the title 20px; the text 14px `--rd-muted` at a 1.6 line height, 8px over the button,
 * which sits in the middle. The bar is one row the same shape as the return bar: 8px / 16px padding, 12px between
 * its words and its button, 13px bold `--rd-danger` on `--rd-danger-soft`; its words 8px after a 1rem glyph; its
 * button 30px high, 12px sides, a 1px `--rd-danger` edge with 6px corners, 12px bold, `--rd-surface` under the
 * pointer, at 60% and no pointer while it asks.
 */

/**
 * The canvas while the session cannot be read: the API is not answering. Takes the place of the
 * page, so no page starts its own spinners against a dead API. The session retries on its own;
 * the button asks now.
 */
export function OutagePanel({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  const { t } = usePrefs();
  return (
    <div
      className="m-auto grid max-w-112 flex-1 content-center justify-items-center gap-2 px-4 py-12 text-center"
      data-slot="outage-panel"
      role="alert"
      aria-busy={busy}
    >
      <span className="mb-2 grid size-14 place-items-center rounded-pill bg-danger-soft text-danger [&_svg]:size-6.5 [&_svg]:stroke-[1.8]" aria-hidden="true">
        <Icon name="offline" />
      </span>
      <h1 className="m-0 text-3xl">{t.outageTitle}</h1>
      <p className="mx-0 mt-0 mb-2 text-base leading-1-6 text-muted">{t.outageText}</p>
      <Button className="justify-self-center" type="button" onClick={onRetry} disabled={busy}>
        {busy ? t.retrying : t.retry}
      </Button>
    </div>
  );
}

// Backoff between pings while the bar is up: 2s, 4s, 8s, 16s, then 30s.
const FIRST_PING_MS = 2_000;
const MAX_PING_MS = 30_000;

/**
 * One line above the page when the API stops answering after the session loaded. Pings the API
 * on a backoff; a success flips the connection flag and the shell drops the bar.
 */
export function OutageBar() {
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const asking = useRef(false);

  useEffect(() => {
    live.current = true;
    let wait = FIRST_PING_MS;
    let timer: number | null = null;
    const ping = async () => {
      if (asking.current || !live.current) return;
      asking.current = true;
      setBusy(true);
      await api.me();
      asking.current = false;
      if (!live.current) return;
      setBusy(false);
      timer = window.setTimeout(() => void ping(), wait);
      wait = Math.min(wait * 2, MAX_PING_MS);
    };
    timer = window.setTimeout(() => void ping(), wait);
    return () => {
      live.current = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  async function retryNow() {
    if (asking.current) return;
    asking.current = true;
    setBusy(true);
    await api.me();
    asking.current = false;
    if (live.current) setBusy(false);
  }

  return (
    <div
      className="flex flex-none items-center justify-between gap-3 bg-danger-soft px-4 py-2 text-md font-bold text-danger"
      data-slot="outage-bar"
      role="alert"
      aria-busy={busy}
    >
      <span className="inline-flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:flex-none">
        <Icon name="offline" />
        {t.outageTitle}
      </span>
      <button
        type="button"
        className="h-7.5 flex-none rounded-sm border border-danger bg-transparent px-3 py-0 text-sm font-bold text-danger hover:bg-surface disabled:cursor-default disabled:opacity-60"
        onClick={() => void retryNow()}
        disabled={busy}
      >
        {busy ? t.retrying : t.retry}
      </button>
    </div>
  );
}
