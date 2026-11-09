'use client';

import { useState } from 'react';
import { AccountName } from '../../components/account-name';
import { Dialog } from '../../components/dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { api, type SessionRuleValues } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { RuleSelects, durationLabel } from '../auth/session-rules';

/**
 * «إعدادات المستخدم» (spec 2026-11-08-overview-and-reports-nav, H), branch owner only: this account's email and
 * mobile, its two-step verification, a new password and its session rules, in one dialog that replaced «الجلسات».
 * Two-step: «تشغيل» asks for it at the next sign-in (the account enrols its own app or number); «إيقاف» clears it.
 */
export function UserSettingsDialog({ loginName, name, onClose, onSaved }: { loginName: string; name?: string; onClose: () => void; onSaved: (note: string) => void }) {
  const { t, apiText, locale } = usePrefs();
  const settings = useApiQuery(['auth', 'user-settings', loginName], () => api.userSettings(loginName), { fresh: true });
  const rules = useApiQuery(['auth', 'session-rules', loginName], () => api.accountSessionRules(loginName), { fresh: true });
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState<SessionRuleValues | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const view = settings.data;
  const ruleView = rules.data;
  const ruleValues = draft ?? ruleView?.own ?? { maxSessions: null, sessionMinutes: null };
  const twoFactorState = !view ? '' : view.twoFactorEnabled ? 'on' : view.twoFactorExempt ? 'off' : 'required';

  async function step(work: () => Promise<{ ok: true } | { ok: false; message: string; code?: string }>) {
    setError('');
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(apiText(result));
      return false;
    }
    return true;
  }

  async function toggleTwoFactor() {
    if (!view) return;
    const done = twoFactorState === 'off'
      ? await step(() => api.setTwoFactorExempt(loginName, false))
      : await step(async () => {
          const cleared = await api.clearUserTwoFactor(loginName);
          return cleared.ok ? api.setTwoFactorExempt(loginName, true) : cleared;
        });
    if (done) await settings.reload();
  }

  async function save() {
    if (!view) return;
    const contact: { email?: string; phone?: string } = {};
    if (email !== null && email !== view.email) contact.email = email;
    if (phone !== null && phone !== view.phone) contact.phone = phone;
    if (Object.keys(contact).length && !(await step(() => api.setUserContact(loginName, contact)))) return;
    if (password && !(await step(() => api.setUserPassword(loginName, password)))) return;
    if (draft && !(await step(() => api.setAccountSessionRules(loginName, ruleValues)))) return;
    onSaved(t.userSettingsSaved);
  }

  return (
    <Dialog
      open
      size="form"
      title={t.userSettings}
      lede={t.userSettingsHint}
      mark="shield"
      tone="neutral"
      closeLabel={t.closeMenu}
      error={error || settings.error || rules.error}
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{t.cancel}</Button>
          <Button type="button" disabled={busy || !view} onClick={save}>{t.save}</Button>
        </>
      )}
    >
      <div className="dialog-form">
        <p className="dialog-who"><AccountName login={loginName} name={name} /></p>
        {view ? (
          <>
            <h3>{t.contactDetails}</h3>
            <label>
              {t.email}
              <input type="email" dir="ltr" value={email ?? view.email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </label>
            <label>
              {t.phone}
              <input type="tel" dir="ltr" value={phone ?? view.phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" />
            </label>

            <h3>{t.twoFactor}</h3>
            <p className="kind-cell">
              <Badge variant={twoFactorState === 'on' ? 'success' : twoFactorState === 'required' ? 'warning' : 'muted'} dot>
                {twoFactorState === 'on' ? t.twoFactorOn : twoFactorState === 'required' ? t.twoFactorRequired : t.twoFactorOff}
              </Badge>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={toggleTwoFactor}>
                {twoFactorState === 'off' ? t.twoFactorTurnOn : t.twoFactorTurnOff}
              </Button>
            </p>

            <h3>{t.newPassword}</h3>
            <label>
              {t.newPassword}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <p className="hint">{t.passwordKeep}</p>

            <h3>{t.sessions}</h3>
            {ruleView ? <RuleSelects values={ruleValues} fallback={ruleView.layer} fallbackLabel={t.followLayer} onChange={setDraft} /> : null}
            {ruleView ? (
              <p className="hint">{`${t.effectiveNow}: ${t.maxSessionsLabel} ${ruleView.effective.maxSessions} · ${durationLabel(locale, ruleView.effective.sessionMinutes)}`}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
