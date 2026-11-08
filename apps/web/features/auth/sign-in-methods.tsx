'use client';

import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { RowMenu } from '../../components/row-menu';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api } from '../../lib/api';
import type { SignInMethods, TwoFactorMethod } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';

// Settings: the second step (app, SMS or email) and the passkeys (spec 2026-11-08-signin-methods).

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
  const [method, setMethod] = useState<TwoFactorMethod>('app');
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
    <section className="pane">
      <header className="pane-head">
        <h2>{t.twoFactor}</h2>
        {enabled && methods ? <Badge variant="success" dot>{`${t.twoFactorOn} · ${methodName(t, methods.twoFactorMethod)}`}</Badge> : null}
      </header>
      <div className="pane-body">
        {!enrolling && (
          <>
            <p className="hint">{t.twoFactorIdle}</p>
            <label>
              {t.twoFactorMethod}
              <Select value={method} onChange={(event) => setMethod(event.target.value as TwoFactorMethod)}>
                <option value="app">{t.methodApp}</option>
                <option value="sms">{t.methodSms}</option>
                <option value="email">{t.methodEmail}</option>
              </Select>
            </label>
            {method !== 'app' && !reachable ? <p className="hint">{t.contactNeeded}</p> : null}
            {method !== 'app' && reachable ? <p className="hint">{t.codeSentTo} <bdi dir="ltr">{contact(method)}</bdi></p> : null}
            <div className="signin-actions">
              <Button type="button" disabled={busy || !reachable} onClick={start}>{enabled ? t.changeMethod : t.enableTwoFactor}</Button>
              {methods?.canDisable ? <Button type="button" variant="secondary" disabled={busy} onClick={disable}>{t.disableTwoFactor}</Button> : null}
            </div>
          </>
        )}
        {enrolling && (
          <form onSubmit={confirm}>
            {otpauth ? (
              <>
                <p className="hint">{t.enrollHint}</p>
                <p className="code" dir="ltr">{otpauth}</p>
              </>
            ) : (
              <p className="hint">{t.codeSentTo} <bdi dir="ltr">{sentTo}</bdi></p>
            )}
            <label>
              {t.code}
              <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required dir="ltr" />
            </label>
            <div className="signin-actions">
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
    <section className="pane">
      <header className="pane-head"><h2>{t.passkeys}</h2></header>
      <div className="pane-body">
        <p className="hint">{t.passkeysHint}</p>
        {passkeys.length === 0 ? <p className="hint">{t.noPasskeys}</p> : (
          <ul className="sessions">
            {passkeys.map((passkey) => (
              <li key={passkey.id}>
                <span className="device" aria-hidden="true"><KeyIcon /></span>
                <span className="session-copy">
                  <strong><bdi>{passkey.name}</bdi></strong>
                  <small className="session-meta">
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
          <form onSubmit={add}>
            <label>
              {t.passkeyName}
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
            </label>
            <Button type="submit" disabled={busy}>{t.addPasskey}</Button>
          </form>
        ) : <p className="hint">{t.passkeyUnsupported}</p>}
      </div>
    </section>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12h9M17 12v3M20 12v2" />
    </svg>
  );
}
