'use client';

import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { RowMenu } from '../../components/row-menu';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import type { SignInMethods, TwoFactorMethod } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { TWO_FACTOR_METHODS, shownAmong } from './two-factor-policy';

// Settings: the second step (app, SMS or email) and the passkeys (spec 2026-11-08-signin-methods).

/*
 * The settings panes' own parts (Tailwind migration T3.2), ported from settings.css, forms.css, pane.css and graphite.css
 * in their cascade order. The panes themselves (`.pane`, `.pane-head`, `.pane-body`) stay legacy classes until T3.3.
 */
/** A note in a pane (pane.css `.pane .hint`): 12px muted, no margin. */
const hintClass = 'm-0 text-sm text-muted';
/** A form in a pane: forms.css's grid, `.pane form`'s 8px gap, graphite's `align-content: start`. */
const paneForm = 'grid content-start gap-2';
/** The buttons under a choice, in one wrapping row 8px apart. */
const actionsClass = 'flex flex-wrap gap-2';
/** The enrolment link (forms.css `.code`): a scrolling 12px line on `--rd-surface-2`, 10px 12px, 6px corners. */
const codeClass = 'm-0 overflow-x-auto rounded-sm bg-surface-2 px-3 py-2.5 text-start text-sm text-ink-2';

/**
 * A session or a passkey as a card (graphite.css "Settings"): a 32px mark, the name and its line, the action at the end;
 * 12px in, on `--rd-surface-2` inside a hairline, 8px apart. The name is 12.5px semibold, the line 11px muted on one
 * line; the line reads left to right, at the reading end in RTL (settings.css `.session-meta`).
 */
export const sessionClass = {
  list: 'm-0 grid list-none gap-2 p-0',
  row: 'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-sm bg-surface-2 p-3 inset-ring inset-ring-line',
  copy: 'grid min-w-0 gap-px',
  name: 'flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold',
  meta: 'truncate text-start text-xs text-muted rtl:text-end',
} as const;
/** The card's mark: a 32px crimson-soft tile with a 15px crimson device or key. */
export const deviceClass = 'grid size-8 place-items-center rounded-sm bg-accent-soft text-accent';

type Notify = { setError: (text: string) => void; setNote: (text: string) => void };
const methodsKey = ['auth', 'sign-in-methods'] as const;

/** The method's name in the current language. */
export function methodName(t: ReturnType<typeof usePrefs>['t'], method: TwoFactorMethod) {
  return method === 'sms' ? t.methodSms : method === 'email' ? t.methodEmail : t.methodApp;
}

/** Whether this browser can make and use passkeys; false on the server render. */
export function usePasskeySupport() {
  return useSyncExternalStore(() => () => {}, browserSupportsWebAuthn, () => false);
}

export function useSignInMethods() {
  return useApiQuery(methodsKey, () => api.signInMethods());
}

export function TwoFactorPane({ methods, reload, setError, setNote }: Notify & { methods: SignInMethods | null | undefined; reload: () => Promise<unknown> }) {
  const { t, apiText } = usePrefs();
  const [picked, setMethod] = useState<TwoFactorMethod>('app');
  // A layer or account held to one method offers only that one (spec 2026-11-11-two-factor-policy).
  const fixedOne = methods?.allowedMethods?.length === 1;
  const allowed = shownAmong(methods?.allowedMethods ?? TWO_FACTOR_METHODS);
  const method = allowed.includes(picked) ? picked : allowed[0];
  // The enrolment under way: the app's link, or where the SMS/email code went.
  const [otpauth, setOtpauth] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = methods?.twoFactorEnabled ?? false;
  const contact = (choice: TwoFactorMethod) => (choice === 'sms' ? methods?.phone : choice === 'email' ? methods?.email : 'app');
  const reachable = Boolean(contact(method));

  function clear() {
    setError('');
    setNote('');
  }

  async function start() {
    clear();
    setCode('');
    setBusy(true);
    if (method === 'app') {
      const result = await api.setupTwoFactor();
      setBusy(false);
      if (!result.ok) return setError(apiText(result));
      setSentTo('');
      setOtpauth(result.data.otpauth);
      return;
    }
    const result = await api.chooseTwoFactorMethod(method);
    setBusy(false);
    if (!result.ok) return setError(apiText(result));
    setOtpauth('');
    setSentTo(result.data.sentTo);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    clear();
    setBusy(true);
    const result = method === 'app' ? await api.confirmTwoFactor(code) : await api.confirmTwoFactorMethod(method, code);
    setBusy(false);
    if (!result.ok) return setError(apiText(result));
    setOtpauth('');
    setSentTo('');
    setCode('');
    setNote(t.enabledTwoFactor);
    await reload();
  }

  async function disable() {
    clear();
    setBusy(true);
    const result = await api.disableTwoFactor();
    setBusy(false);
    if (!result.ok) return setError(apiText(result));
    setNote(t.disabledTwoFactor);
    await reload();
  }

  const enrolling = Boolean(otpauth || sentTo);
  return (
    <section className="pane w-full">
      <header className="pane-head">
        <h2>{t.twoFactor}</h2>
        {enabled && methods ? <Badge variant="success" dot>{`${t.twoFactorOn} · ${methodName(t, methods.twoFactorMethod)}`}</Badge> : null}
      </header>
      <div className="pane-body">
        {!enrolling && (
          <>
            <p className={hintClass}>{t.twoFactorIdle}</p>
            {/* The methods as cards to choose from (Graphite): the name, then where the code goes. Three across on the
                profile page (ported from the legacy `.settings-page .method-cards`), one under 521px. */}
            {allowed.length === 1 ? (
              fixedOne ? <p className={hintClass}><b>{t.methodOnly}:</b> {methodName(t, allowed[0])}</p> : null
            ) : (
            <div className="grid grid-cols-3 gap-2 max-[521px]:grid-cols-1" role="radiogroup" aria-label={t.twoFactorMethod}>
              {allowed.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={method === key}
                  className={cn(
                    'grid gap-0.5 rounded-sm border-0 p-3 text-start text-ink max-[721px]:min-h-11',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    method === key ? 'bg-accent-soft inset-ring inset-ring-accent' : 'bg-surface-2 inset-ring inset-ring-line hover:bg-surface-3',
                  )}
                  onClick={() => setMethod(key)}
                >
                  <b className="text-md font-bold">{methodName(t, key)}</b>
                  <small className="text-[11.5px] text-muted" dir={key === 'app' ? undefined : 'ltr'}>{key === 'app' ? t.methodAppHint : contact(key) || '—'}</small>
                </button>
              ))}
            </div>
            )}
            {method !== 'app' && !reachable ? <p className={hintClass}>{t.contactNeeded}</p> : null}
            {method !== 'app' && reachable ? <p className={hintClass}>{t.codeSentTo} <bdi dir="ltr">{contact(method)}</bdi></p> : null}
            <div className={actionsClass}>
              <Button type="button" disabled={busy || !reachable} onClick={start}>{enabled ? t.changeMethod : t.enableTwoFactor}</Button>
              {methods?.canDisable ? <Button type="button" variant="secondary" disabled={busy} onClick={disable}>{t.disableTwoFactor}</Button> : null}
            </div>
          </>
        )}
        {enrolling && (
          <form className={paneForm} onSubmit={confirm}>
            {otpauth ? (
              <>
                <p className={hintClass}>{t.enrollHint}</p>
                <p className={codeClass} dir="ltr">{otpauth}</p>
              </>
            ) : (
              <p className={hintClass}>{t.codeSentTo} <bdi dir="ltr">{sentTo}</bdi></p>
            )}
            <Label tone="pane">
              {t.code}
              <Input surface="surface" className="text-md" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required dir="ltr" />
            </Label>
            <div className={actionsClass}>
              <Button type="submit" disabled={busy}>{t.confirmEnable}</Button>
              {sentTo ? <Button type="button" variant="secondary" disabled={busy} onClick={start}>{t.resendCode}</Button> : null}
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setOtpauth(''); setSentTo(''); }}>{t.cancel}</Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

export function PasskeysPane({ methods, reload, setError, setNote, when }: Notify & { methods: SignInMethods | null | undefined; reload: () => Promise<unknown>; when: (value: string) => string }) {
  const { t, apiText } = usePrefs();
  const supported = usePasskeySupport();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const passkeys = methods?.passkeys ?? [];

  async function add(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNote('');
    setBusy(true);
    const result = await api.addPasskey(name);
    setBusy(false);
    if (!result.ok) return setError(apiText(result));
    setName('');
    setNote(t.passkeyAdded);
    await reload();
  }

  async function remove(id: string) {
    setError('');
    setNote('');
    const result = await api.removePasskey(id);
    if (!result.ok) return setError(apiText(result));
    setNote(t.passkeyRemoved);
    await reload();
  }

  return (
    <section className="pane w-full">
      <header className="pane-head"><h2>{t.passkeys}</h2></header>
      <div className="pane-body">
        <p className={hintClass}>{t.passkeysHint}</p>
        {passkeys.length === 0 ? <p className={hintClass}>{t.noPasskeys}</p> : (
          <ul className={sessionClass.list}>
            {passkeys.map((passkey) => (
              <li key={passkey.id} className={sessionClass.row}>
                <span className={deviceClass} aria-hidden="true"><KeyIcon /></span>
                <span className={sessionClass.copy}>
                  <strong className={sessionClass.name}><bdi>{passkey.name}</bdi></strong>
                  {/* Left to right, as the session's line: the legacy `.session-meta { direction: ltr }`. */}
                  <small className={sessionClass.meta} dir="ltr">
                    {t.passkeyLastUsed}: {passkey.lastUsedAt ? <bdi dir="ltr">{when(passkey.lastUsedAt)}</bdi> : t.passkeyNeverUsed}
                  </small>
                </span>
                <RowMenu
                  label={`${t.removePasskey} ${passkey.name}`}
                  items={[{ label: t.removePasskey, icon: 'trash', danger: true, onClick: () => remove(passkey.id) }]}
                />
              </li>
            ))}
          </ul>
        )}
        {supported ? (
          <form className={paneForm} onSubmit={add}>
            <Label tone="pane">
              {t.passkeyName}
              <Input surface="surface" className="text-md" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
            </Label>
            <Button type="submit" disabled={busy}>{t.addPasskey}</Button>
          </form>
        ) : <p className={hintClass}>{t.passkeyUnsupported}</p>}
      </div>
    </section>
  );
}

function KeyIcon() {
  return (
    <svg className="size-3.75" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12h9M17 12v3M20 12v2" />
    </svg>
  );
}
