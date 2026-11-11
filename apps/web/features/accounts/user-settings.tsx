'use client';

import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/alert';
import { api, type SessionRuleValues } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { RuleSelects, durationLabel, sessionRulesValid } from '../auth/session-rules';

/**
 * «إعدادات الحساب» (spec 2026-11-08-overview-and-reports-nav, H), branch owner only: this account's email and
 * mobile, its two-step verification, a new password and its session rules. Since spec 2026-11-11-ui-consistency-pass
 * (D3) it is the open top of the user page's «الإعدادات والصلاحيات» tab, not a dialog behind a menu.
 * Two-step: «تشغيل» asks for it at the next sign-in (the account enrols its own app or number); «إيقاف» clears it.
 */
export function UserSettingsPane({ loginName, onSaved }: { loginName: string; onSaved: (note: string) => void }) {
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
    // Each part clears its draft once saved, so a later failure does not send it again.
    if (Object.keys(contact).length) {
      if (!(await step(() => api.setUserContact(loginName, contact)))) return;
      setEmail(null);
      setPhone(null);
      await settings.reload();
    }
    if (password) {
      if (!(await step(() => api.setUserPassword(loginName, password)))) return;
      setPassword('');
    }
    if (draft) {
      if (!(await step(() => api.setAccountSessionRules(loginName, ruleValues)))) return;
      setDraft(null);
    }
    await Promise.all([settings.reload(), rules.reload()]);
    onSaved(t.userSettingsSaved);
  }

  return (
    <section className="settings-block user-settings" aria-label={t.userSettings}>
      <h3>{t.userSettings}</h3>
      <p className="hint">{t.userSettingsHint}</p>
      <Alert banner>{error || settings.error || rules.error}</Alert>
      {view ? (
        <>
          <div className="pair">
            <label>
              {t.email}
              <input type="email" dir="ltr" value={email ?? view.email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </label>
            <label>
              {t.phone}
              <input type="tel" dir="ltr" value={phone ?? view.phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" />
            </label>
          </div>
          <div className="pair">
            <label>
              {t.newPassword}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <span className="hint">{t.passwordKeep}</span>
            </label>
            <div className="field-like">
              <span>{t.twoFactor}</span>
              <p className="kind-cell">
                <Badge variant={twoFactorState === 'on' ? 'success' : twoFactorState === 'required' ? 'warning' : 'muted'} dot>
                  {twoFactorState === 'on' ? t.twoFactorOn : twoFactorState === 'required' ? t.twoFactorRequired : t.twoFactorOff}
                </Badge>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={toggleTwoFactor}>
                  {twoFactorState === 'off' ? t.twoFactorTurnOn : t.twoFactorTurnOff}
                </Button>
              </p>
            </div>
          </div>
          {ruleView ? (
            <div className="session-rules-block">
              <span className="field-title">{t.sessions}</span>
              <RuleSelects values={ruleValues} fallback={ruleView.layer} fallbackLabel={t.followLayer} onChange={setDraft} />
              <p className="hint">{`${t.effectiveNow}: ${t.maxSessionsLabel} ${ruleView.effective.maxSessions} · ${durationLabel(locale, ruleView.effective.sessionMinutes)}`}</p>
            </div>
          ) : null}
          <div className="form-save"><Button type="button" disabled={busy || !sessionRulesValid(ruleValues)} onClick={save}>{t.save}</Button></div>
        </>
      ) : null}
    </section>
  );
}
