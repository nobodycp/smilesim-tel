'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { AuthArt, AuthBrand } from '../../../components/auth-art';
import { LanguageSwitch, ThemeToggle } from '../../../components/chrome';
import { api, routeFor } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { usePasskeySupport } from '../sign-in-methods';

export function LoginScreen() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const door = useDoor();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const message = failure ? apiText(failure) : '';
  const passkeys = usePasskeySupport();

  async function withPasskey() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    const result = await api.passkeyLogin();
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setFailure({ message: result.message, code: result.code });
      return;
    }
    router.push(routeFor(result.data.next));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    const result = await api.login(loginName, password);
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setFailure({ message: result.message, code: result.code });
      return;
    }
    router.push(routeFor(result.data.next));
  }

  // Graphite sign-in (spec 2026-11-09-graphite-identity): the form on the reading side, the art beside it.
  return (
    <main className="gauth">
      <section className="gauth-form">
        <div className="gauth-tools">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <div className="gauth-card">
          <AuthBrand />
          <div className="gauth-head login-enter a">
            <h1>{t.loginTitle}</h1>
            <span className="gauth-door">{t[door.label]}</span>
          </div>
          <form onSubmit={submit}>
            <div className="gauth-field login-enter b">
              <label htmlFor="login-name">{t.loginName}</label>
              <div className="gauth-box">
                <UserMark />
                <input
                  id="login-name"
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  autoComplete="username"
                  required
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'login-error' : undefined}
                />
              </div>
            </div>
            <div className="gauth-field login-enter c">
              <label htmlFor="login-password">{t.password}</label>
              <div className="gauth-box">
                <LockMark />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  className="gauth-reveal"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? t.hidePassword : t.showPassword}
                </button>
              </div>
            </div>
            <Alert id="login-error">{message}</Alert>
            <button className="gauth-go login-enter d" type="submit" disabled={busy} aria-busy={busy}>
              <span>{t.signIn}</span>
            </button>
            {passkeys ? (
              <button className="gauth-passkey login-enter d" type="button" disabled={busy} onClick={withPasskey}>
                <KeyRound size={16} strokeWidth={1.9} aria-hidden="true" />
                {t.passkeySignIn}
              </button>
            ) : null}
          </form>
          <p className="gauth-help">{t.loginHelp}</p>
        </div>
      </section>
      <AuthArt />
    </main>
  );
}

function UserMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c1.2-3 3.5-4.4 6.5-4.4s5.3 1.4 6.5 4.4" />
    </svg>
  );
}

function LockMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="6" y="10.5" width="12" height="9" rx="2" />
      <path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3" />
    </svg>
  );
}
