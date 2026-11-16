'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { AuthArt, AuthBrand } from '../../../components/auth-art';
import { authClass } from '../../../components/auth-frame';
import { Label } from '../../../components/ui/label';
import { cn } from '../../../lib/cn';
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
    <main data-slot="auth" className={authClass.frame}>
      <section className={authClass.side}>
        <div className={authClass.tools}>
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <div className={authClass.card}>
          <AuthBrand />
          <div className={cn(authClass.head, enter)}>
            <h1 className={authClass.title}>{t.loginTitle}</h1>
            <span className="inline-flex h-5.5 items-center rounded-xs px-2 text-caption font-bold text-accent inset-ring inset-ring-current">
              {t[door.label]}
            </span>
          </div>
          <form className={authClass.form} onSubmit={submit}>
            <div className={cn(fieldClass, enterAfter70)}>
              <Label htmlFor="login-name" className={labelClass}>{t.loginName}</Label>
              <div className={boxClass}>
                <UserMark />
                <input
                  id="login-name"
                  className={inputClass}
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  autoComplete="username"
                  required
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'login-error' : undefined}
                />
              </div>
            </div>
            <div className={cn(fieldClass, enterAfter140)}>
              <Label htmlFor="login-password" className={labelClass}>{t.password}</Label>
              <div className={boxClass}>
                <LockMark />
                <input
                  id="login-password"
                  className={inputClass}
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
                  className={cn(
                    'grid size-8 flex-none place-items-center rounded-xs border-0 bg-transparent p-0 text-muted',
                    'hover:bg-surface-2 hover:text-ink',
                    focusRing,
                  )}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  title={showPassword ? t.hidePassword : t.showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {/* An eye, as sign-in fields show it (owner 2026-11-09); the words stay its name. */}
                  {showPassword ? <EyeOff className="size-4.5" size={18} strokeWidth={1.9} aria-hidden="true" /> : <Eye className="size-4.5" size={18} strokeWidth={1.9} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <Alert id="login-error">{message}</Alert>
            <button
              className={cn(actionClass, 'bg-accent-fill text-on-accent hover:bg-accent-fill-hover', enterAfter210)}
              type="submit"
              disabled={busy}
              aria-busy={busy}
            >
              <span>{t.signIn}</span>
            </button>
            {passkeys ? (
              <button
                className={cn(actionClass, 'bg-surface-2 text-ink inset-ring inset-ring-line-strong hover:bg-surface-3', enterAfter210)}
                type="button"
                disabled={busy}
                onClick={withPasskey}
              >
                <KeyRound size={16} strokeWidth={1.9} aria-hidden="true" />
                {t.passkeySignIn}
              </button>
            ) : null}
          </form>
          <p className="m-0 text-chip text-muted">{t.loginHelp}</p>
        </div>
      </section>
      <AuthArt />
    </main>
  );
}

/*
 * The sign-in page's own parts (Tailwind migration T3.2), ported from graphite.css's sign-in block and auth.css's
 * entrance: each field a 6px grid, its label 12px semibold muted; the field a 44px sunken box with an inset hairline
 * at 70% of `--rd-field` and a muted 18px mark, crimson hairline and the focus ring while its input has focus; the
 * input bare inside it, keeping the box's fill when the browser autofills it (owner 2026-11-09); the two actions 44px,
 * bold, pressed to 98%, half-faded while busy. The head, the fields and the actions rise in 70ms apart.
 */
const enter = 'motion-safe:animate-[login-in_400ms_var(--rd-ease-out)_both]';
const enterAfter70 = 'motion-safe:animate-[login-in_400ms_var(--rd-ease-out)_70ms_both]';
const enterAfter140 = 'motion-safe:animate-[login-in_400ms_var(--rd-ease-out)_140ms_both]';
const enterAfter210 = 'motion-safe:animate-[login-in_400ms_var(--rd-ease-out)_210ms_both]';
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldClass = 'grid gap-1.5';
const labelClass = 'text-sm text-muted';
const boxClass = cn(
  'flex h-11 items-center gap-2.5 rounded-sm bg-sunken px-3 text-muted inset-ring inset-ring-field/70',
  'focus-within:ring-3 focus-within:ring-focus focus-within:inset-ring-accent',
);
const inputClass = cn(
  'h-full w-full min-w-0 flex-1 rounded-sm border-0 bg-transparent p-0 text-base text-ink shadow-none focus:outline-none',
  '[&:is(:autofill,:-webkit-autofill)]:[-webkit-text-fill-color:var(--rd-ink)] [&:is(:autofill,:-webkit-autofill)]:caret-ink',
  '[&:is(:autofill,:-webkit-autofill)]:shadow-[inset_0_0_0_1000px_var(--rd-sunken)]',
  '[&:is(:autofill,:-webkit-autofill)]:[transition:background-color_600000s_0s,color_600000s_0s]',
);
const actionClass = cn(
  'inline-flex h-11 items-center justify-center gap-2 rounded-sm border-0 font-bold',
  '[transition:background-color_var(--rd-dur-fast)_var(--rd-ease-standard),transform_110ms_var(--rd-ease-standard)]',
  'enabled:active:[transform:scale(0.98)] disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
);

function UserMark() {
  return (
    <svg className="size-4.5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c1.2-3 3.5-4.4 6.5-4.4s5.3 1.4 6.5 4.4" />
    </svg>
  );
}

function LockMark() {
  return (
    <svg className="size-4.5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="6" y="10.5" width="12" height="9" rx="2" />
      <path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3" />
    </svg>
  );
}
