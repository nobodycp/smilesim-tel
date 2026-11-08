'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthFrame } from '../../../components/auth-frame';
import { api, routeFor, TWO_FACTOR_STEP_KEY } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { Button } from '../../../components/ui/button';

// The sign-in step left in sessionStorage says whether this visit enrolls a new code or checks one. Read through
// useSyncExternalStore: the server render (no storage) says "check", the browser answers on hydration.
const noSubscribe = () => () => {};
const readEnrolling = () => sessionStorage.getItem(TWO_FACTOR_STEP_KEY) === 'enroll';
const serverEnrolling = () => false;

export function TwoFactorScreen() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const enrolling = useSyncExternalStore(noSubscribe, readEnrolling, serverEnrolling);
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enrolling) return;
    api.setupTwoFactor().then((result) => {
      if (result.ok) setOtpauth(result.data.otpauth);
      else setMessage(apiText(result));
    });
  }, [enrolling, apiText]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = enrolling ? await api.confirmTwoFactor(code) : await api.verifyTwoFactor(code);
    setBusy(false);
    if (!result.ok) {
      setMessage(apiText(result));
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <AuthFrame
      kicker={t.verifyKicker}
      title={enrolling ? t.enrollTitle : t.codeTitle}
      lede={enrolling ? t.enrollLede : t.codeLede}
    >
      {enrolling && otpauth && <p className="code" dir="ltr">{otpauth}</p>}
      <form onSubmit={submit}>
        <label>
          {t.code}
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        <Alert>{message}</Alert>
        <Button type="submit" size="lg" disabled={busy}>{t.confirm}</Button>
      </form>
    </AuthFrame>
  );
}
