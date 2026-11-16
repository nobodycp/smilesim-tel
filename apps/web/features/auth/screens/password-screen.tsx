'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthFrame, authClass, authInputClass } from '../../../components/auth-frame';
import { api, routeFor } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

export function PasswordScreen() {
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
      <form className={authClass.form} onSubmit={submit}>
        <Label>
          {t.currentPassword}
          <Input size="lg" className={authInputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Label>
        <Label>
          {t.newPassword}
          <Input size="lg" className={authInputClass} type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" required />
        </Label>
        <Alert>{message}</Alert>
        <Button type="submit" size="lg" disabled={busy}>{t.save}</Button>
      </form>
    </AuthFrame>
  );
}
