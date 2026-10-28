'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, routeFor } from '../../lib/api';

export default function PasswordPage() {
  const router = useRouter();
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
      setMessage(result.message);
      return;
    }
    router.push(routeFor(result.data.next));
  }

  return (
    <>
      <h1>تغيير كلمة السر</h1>
      <p className="lede">اختر كلمة سر جديدة قبل المتابعة.</p>
      <form onSubmit={submit}>
        <label>
          كلمة السر الحالية
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          كلمة السر الجديدة
          <input type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" required />
        </label>
        {message && <p className="error" role="alert">{message}</p>}
        <button type="submit" disabled={busy}>حفظ</button>
      </form>
    </>
  );
}
