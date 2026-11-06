'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { Icon } from './icon';

/**
 * The canvas while the session cannot be read: the API is not answering. Takes the place of the
 * page, so no page starts its own spinners against a dead API. The session retries on its own;
 * the button asks now.
 */
export function OutagePanel({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  const { t } = usePrefs();
  return (
    <div className="outage-panel" role="alert" aria-busy={busy}>
      <span className="outage-mark" aria-hidden="true">
        <Icon name="offline" />
      </span>
      <h1>{t.outageTitle}</h1>
      <p>{t.outageText}</p>
      <button type="button" className="btn" onClick={onRetry} disabled={busy}>
        {busy ? t.retrying : t.retry}
      </button>
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
      await api.officeMe();
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
    await api.officeMe();
    asking.current = false;
    if (live.current) setBusy(false);
  }

  return (
    <div className="outage-bar" role="alert" aria-busy={busy}>
      <span className="outage-bar-text">
        <Icon name="offline" />
        {t.outageTitle}
      </span>
      <button type="button" onClick={() => void retryNow()} disabled={busy}>
        {busy ? t.retrying : t.retry}
      </button>
    </div>
  );
}
