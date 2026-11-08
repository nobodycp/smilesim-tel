'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { BrandLogo } from '../../../components/brand-logo';
import { LanguageSwitch, ThemeToggle } from '../../../components/chrome';
import { api, routeFor } from '../../../lib/api';
import { useBranding } from '../../../lib/branding';
import { useDoor } from '../../../lib/door-context';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';

export function LoginScreen() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const door = useDoor();
  const branding = useBranding();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const message = failure ? apiText(failure) : '';

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

  return (
    <main className="login-room">
      <header className="login-banner">
        <i className="login-crop a" aria-hidden="true" />
        <i className="login-crop b" aria-hidden="true" />
        <i className="login-crop c" aria-hidden="true" />
        <i className="login-crop d" aria-hidden="true" />
        <div className="login-mast">
          <div className="auth-tools">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
        </div>
        <div className="login-lockrow">
          <div className="login-lockup">
            <BrandLogo className="login-logo" onInk />
            <strong>{branding.name}</strong>
            <small>{branding.tagline}</small>
          </div>
          <Plate />
        </div>
      </header>
      <div className="login-seam" aria-hidden="true" />
      <section className="login-doc">
        <div className="login-doc-inner">
          <div className="login-head login-enter a">
            <h1>{t.loginTitle}</h1>
            <p className="login-role">{t[door.label]}</p>
          </div>
          <form onSubmit={submit}>
            <div className="login-field login-enter b">
              <label htmlFor="login-name">{t.loginName}</label>
              <div className="login-box">
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
            <div className="login-field login-enter c">
              <label htmlFor="login-password">{t.password}</label>
              <div className="login-box">
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
                  className="login-reveal"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? t.hidePassword : t.showPassword}
                </button>
              </div>
            </div>
            <Alert id="login-error">{message}</Alert>
            <button className="login-go login-enter d" type="submit" disabled={busy} aria-busy={busy}>
              <span>{t.signIn}</span>
            </button>
          </form>
          <div className="login-meta">
            <p className="login-help">{t.loginHelp}</p>
            <bdi dir="ltr">{new Date().getFullYear()}</bdi>
          </div>
        </div>
      </section>
    </main>
  );
}

function Plate() {
  return (
    <svg className="login-plate" viewBox="0 0 200 250" aria-hidden="true">
      <g className="heavy">
        <rect x="18" y="16" width="164" height="218" rx="22" />
      </g>
      <g className="light">
        <rect x="46" y="52" width="108" height="146" rx="12" />
        <rect x="74" y="96" width="52" height="64" />
        <path d="M74 118h52M74 140h52M100 96v64" />
        <path d="M18 125h28M154 125h28M100 16v20M100 214v20" />
      </g>
    </svg>
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
