'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthFrame } from '../../../components/auth-frame';
import { buttonClass } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { reloadAt } from '../../../lib/reload-at';

/**
 * The door of an entered account. The admin's «دخول» sends the browser here with a one-time code in the fragment
 * (never sent to a server); this page trades it for this door's cookies, then opens the office.
 */
export function EnterScreen() {
  const { t } = usePrefs();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // The code works once: a second run (React's dev double effect) would spend nothing and fail.
    if (started.current) return;
    started.current = true;
    const code = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    const traded = code ? api.handoff(code).then((result) => result.ok) : Promise.resolve(false);
    void traded.then((ok) => {
      if (ok) reloadAt('/');
      else setFailed(true);
    });
  }, []);

  return (
    <AuthFrame kicker={t.enterAccount} title={failed ? t.enterFailed : t.enterOpening} lede="">
      {failed ? <a className={buttonClass({})} href="/login">{t.enterBackToLogin}</a> : null}
    </AuthFrame>
  );
}
