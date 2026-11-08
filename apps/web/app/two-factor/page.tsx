'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { api, routeFor, TWO_FACTOR_STEP_KEY } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function TwoFactorPage() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const [enrolling, setEnrolling] = useState(false);
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isEnroll = sessionStorage.getItem(TWO_FACTOR_STEP_KEY) === 'enroll';
    setEnrolling(isEnroll);
    if (!isEnroll) return;
    api.setupTwoFactor().then((result) => {
      if (result.ok) setOtpauth(result.data.otpauth);
      else setMessage(apiText(result));
    });
  }, [apiText]);

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
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>{t.confirm}</button>
      </form>
    </AuthFrame>
  );
}
