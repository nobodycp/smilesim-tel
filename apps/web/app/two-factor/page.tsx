'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, routeFor, TWO_FACTOR_STEP_KEY } from '../../lib/api';

export default function TwoFactorPage() {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The step is stored by `routeFor` from the API's `next` field.
    const isEnroll = sessionStorage.getItem(TWO_FACTOR_STEP_KEY) === 'enroll';
    setEnrolling(isEnroll);
    if (!isEnroll) return;
    api.setupTwoFactor().then((result) => {
      if (result.ok) setOtpauth(result.data.otpauth);
      else setMessage(result.message);
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = enrolling ? await api.confirmTwoFactor(code) : await api.verifyTwoFactor(code);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <>
      <h1>{enrolling ? 'تفعيل التحقق بخطوتين' : 'رمز التحقق'}</h1>
      <p className="lede">{enrolling ? 'أضف الرابط التالي إلى تطبيق المصادقة ثم أدخل الرمز.' : 'أدخل الرمز من تطبيق المصادقة.'}</p>
      {enrolling && otpauth && <p className="code" dir="ltr">{otpauth}</p>}
      <form onSubmit={submit}>
        <label>
          الرمز
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>تأكيد</button>
      </form>
    </>
  );
}
