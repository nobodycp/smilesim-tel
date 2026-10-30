'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { api, routeFor } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { usePrefs } from '../../lib/prefs';

export default function LoginPage() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const door = useDoor();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await api.login(loginName, password);
    setBusy(false);
    if (!result.ok) {
      setMessage(apiText(result.message));
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <AuthFrame kicker={t[door.label]} title={t.loginTitle} lede={t.loginLede}>
      <form onSubmit={submit}>
        <label>
          {t.loginName}
          <input value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          {t.password}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>{t.signIn}</button>
      </form>
    </AuthFrame>
  );
}
