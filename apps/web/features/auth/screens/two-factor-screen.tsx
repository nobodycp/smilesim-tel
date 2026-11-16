'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthFrame, authClass, authInputClass } from '../../../components/auth-frame';
import { api, routeFor, TWO_FACTOR_STEP_KEY } from '../../../lib/api';
import type { TwoFactorMethod } from '../../../lib/api-types';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectItem } from '../../../components/ui/select';
import { methodName } from '../sign-in-methods';
import { TWO_FACTOR_METHODS, shownAmong } from '../two-factor-policy';

/** The enrolment link (forms.css `.code`): a scrolling 12px line on `--rd-surface-2`, 10px 12px, 6px corners. */
const codeClass = 'm-0 overflow-x-auto rounded-sm bg-surface-2 px-3 py-2.5 text-start text-sm text-ink-2';

// The sign-in step left in sessionStorage says whether this visit enrolls a new code or checks one. Read through
// useSyncExternalStore: the server render (no storage) says "check", the browser answers on hydration.
const noSubscribe = () => () => {};
const readEnrolling = () => sessionStorage.getItem(TWO_FACTOR_STEP_KEY) === 'enroll';
const serverEnrolling = () => false;

/**
 * Enrolling: the authenticator app (its link) by default, or SMS / email (a code sent to the account's phone or
 * email). Checking: an SMS or email account gets its code sent on arrival, with a resend; the app sends nothing.
 */
export function TwoFactorScreen() {
  const router = useRouter();
  const { t, apiText } = usePrefs();
  const enrolling = useSyncExternalStore(noSubscribe, readEnrolling, serverEnrolling);
  const [picked, setMethod] = useState<TwoFactorMethod>('app');
  // Enrolling: the methods this account may use, from the API (one when its layer or account fixes the method).
  const [allowed, setAllowed] = useState<TwoFactorMethod[] | null>(null);
  const [fixedOne, setFixedOne] = useState(false);
  const method = enrolling && allowed && !allowed.includes(picked) ? allowed[0] : picked;
  const [otpauth, setOtpauth] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [retryIn, setRetryIn] = useState(0);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enrolling) return;
    api.enrolmentMethods().then((result) => {
      const list = result.ok ? result.data.allowedMethods : TWO_FACTOR_METHODS;
      setFixedOne(list.length === 1);
      setAllowed(shownAmong(list));
    });
  }, [enrolling]);

  // Enrolling with the app: one new secret per visit.
  useEffect(() => {
    if (!enrolling || !allowed || method !== 'app' || otpauth) return;
    api.setupTwoFactor().then((result) => {
      if (result.ok) setOtpauth(result.data.otpauth);
      else setMessage(apiText(result));
    });
  }, [enrolling, allowed, method, otpauth, apiText]);

  // Checking: ask which method this account uses; an SMS or email one gets its code now.
  useEffect(() => {
    if (enrolling) return;
    api.sendTwoFactorCode().then((result) => {
      // A method that cannot be carried out now (no SMS or email gateway) says so instead of waiting for a code.
      if (!result.ok) return void setMessage(apiText(result));
      setMethod(result.data.method);
      if (result.data.sentTo) setSentTo(result.data.sentTo);
      setRetryIn(result.data.retryIn ?? 0);
    });
  }, [enrolling, apiText]);

  // The resend countdown.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => setRetryIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  async function send() {
    setMessage('');
    setBusy(true);
    const result = enrolling && method !== 'app' ? await api.chooseTwoFactorMethod(method) : await api.sendTwoFactorCode();
    setBusy(false);
    if (!result.ok) return setMessage(apiText(result));
    if (result.data.sentTo) setSentTo(result.data.sentTo);
    setRetryIn(result.data.retryIn ?? 0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = !enrolling
      ? await api.verifyTwoFactor(code)
      : method === 'app'
        ? await api.confirmTwoFactor(code)
        : await api.confirmTwoFactorMethod(method, code);
    setBusy(false);
    if (!result.ok) {
      setMessage(apiText(result));
      return;
    }
    router.push(routeFor(result.data.next));
  }

  const byCode = method !== 'app';
  const lede = enrolling
    ? byCode ? t.enrollLedeCode : t.enrollLede
    : method === 'sms' ? t.codeLedeSms : method === 'email' ? t.codeLedeEmail : t.codeLede;

  return (
    <AuthFrame kicker={t.verifyKicker} title={enrolling ? t.enrollTitle : t.codeTitle} lede={lede}>
      {enrolling && allowed && allowed.length > 1 && (
        <Label>
          {t.twoFactorMethod}
          <Select value={method} onValueChange={(next) => { setMethod(next as TwoFactorMethod); setSentTo(''); setMessage(''); }}>
            {allowed.map((key) => <SelectItem key={key} value={key}>{methodName(t, key)}</SelectItem>)}
          </Select>
        </Label>
      )}
      {/* The two notes are plain paragraphs: no legacy rule reached a `.hint` on these pages, so they keep the
          browser's own paragraph margins. */}
      {enrolling && allowed && allowed.length === 1 && fixedOne && <p data-testid="method-only"><b>{t.methodOnly}:</b> {methodName(t, allowed[0])}</p>}
      {enrolling && !byCode && otpauth && <p className={codeClass} dir="ltr">{otpauth}</p>}
      {byCode && sentTo && <p>{t.codeSentTo} <bdi dir="ltr">{sentTo}</bdi></p>}
      <form className={authClass.form} onSubmit={submit}>
        {(!byCode || sentTo) && (
          <Label>
            {t.code}
            <Input size="lg" className={authInputClass} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
          </Label>
        )}
        <Alert>{message}</Alert>
        {(!byCode || sentTo) && <Button type="submit" size="lg" disabled={busy}>{t.confirm}</Button>}
        {byCode && (
          <Button type="button" variant={sentTo ? 'secondary' : 'primary'} size="lg" disabled={busy || retryIn > 0} onClick={send}>
            {sentTo ? (retryIn > 0 ? `${t.resendCode} (${retryIn})` : t.resendCode) : t.sendCode}
          </Button>
        )}
      </form>
    </AuthFrame>
  );
}
