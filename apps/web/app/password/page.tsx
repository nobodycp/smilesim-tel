'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { api, routeFor } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function PasswordPage() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const [password, setPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await api.changePassword(password, nextPassword);
    setBusy(false);
    if (!result.ok) {
      setMessage(apiText(result));
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <AuthFrame kicker={t.passwordKicker} title={t.passwordTitle} lede={t.passwordLede}>
      <form onSubmit={submit}>
        <label>
          {t.currentPassword}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          {t.newPassword}
          <input type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" required />
        </label>
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>{t.save}</button>
      </form>
    </AuthFrame>
  );
}
