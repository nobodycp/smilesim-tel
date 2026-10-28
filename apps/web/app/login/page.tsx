'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, routeFor } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
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
      setMessage(result.message);
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <>
      <h1>تسجيل الدخول</h1>
      <p className="lede">أدخل بيانات حسابك للمتابعة.</p>
      <form onSubmit={submit}>
        <label>
          اسم الدخول
          <input value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          كلمة السر
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>دخول</button>
      </form>
    </>
  );
}
