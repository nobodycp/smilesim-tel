'use client';

import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/alert';
import { api, type SessionRuleValues } from '../../lib/api';
import type { LayerKey, TwoFactorMethod, TwoFactorMode } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { RuleSelects, durationLabel, sessionRulesValid } from '../auth/session-rules';
import { methodName } from '../auth/sign-in-methods';
import { MethodField, ModeSeg } from '../auth/two-factor-policy';

/**
 * «إعدادات الحساب» (spec 2026-11-08-overview-and-reports-nav, H), branch owner only: this account's email and
 * mobile, its two-step verification, a new password and its session rules. Since spec 2026-11-11-ui-consistency-pass
 * (D3) it is the open top of the user page's «الإعدادات والصلاحيات» tab, not a dialog behind a menu.
 * Two-step (spec 2026-11-11-two-factor-policy): follow the layer's rule, required of this account (with its own method
 * or the layer's), or optional; «إعادة تعيين» clears the account's enrolment so it enrols again.
 */
export function UserSettingsPane({ loginName, layer, onSaved }: { loginName: string; layer: LayerKey; onSaved: (note: string) => void }) {
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
  const layerRule = useApiQuery(['auth', 'two-factor-policy'], () => api.twoFactorPolicy(), { fresh: true });
  const [rule, setRule] = useState<{ mode: TwoFactorMode; method: TwoFactorMethod | '' } | null>(null);
  const ruleNow = rule ?? (view ? { mode: view.twoFactorMode, method: view.requiredMethod ?? '' } : null);
  const layerMethod = view && layerRule.data ? layerRule.data.policy[layer] : null;

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

  async function resetTwoFactor() {
    if (await step(() => api.clearUserTwoFactor(loginName))) await settings.reload();
  }

  async function save() {
    if (!view) return;
    let ended = 0;
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
    if (rule) {
      const saved = await api.setAccountTwoFactor(loginName, { mode: rule.mode, method: rule.mode === 'required' ? rule.method || null : null });
      if (!saved.ok) return void setError(apiText(saved));
      setRule(null);
      if (saved.data.endedAccounts > 0) ended = saved.data.endedAccounts;
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
    onSaved(ended ? `${t.userSettingsSaved} · ${t.twoFactorEnded.replace('{count}', String(ended))}` : t.userSettingsSaved);
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
          </div>
          {ruleNow ? (
            <div className="session-rules-block two-factor-block">
              <span className="field-title">{t.twoFactor}</span>
              <p className="hint tf-lede">{t.accountTwoFactorHint}</p>
              <ModeSeg
                value={ruleNow.mode}
                label={t.twoFactor}
                options={[{ value: 'follow', label: t.followLayer }, { value: 'required', label: t.twoFactorModeRequired }, { value: 'optional', label: t.twoFactorOptional }]}
                onChange={(mode) => setRule({ ...ruleNow, mode })}
              />
              {ruleNow.mode === 'required' ? (
                <MethodField
                  label={t.twoFactorMethod}
                  value={ruleNow.method}
                  followLabel={layerMethod ? t.layerMethodOption.replace('{method}', methodName(t, layerMethod.method)) : t.followLayer}
                  onChange={(method) => setRule({ ...ruleNow, method })}
                />
              ) : null}
              <p className="tf-status">
                <Badge variant={view.twoFactorEnabled ? 'success' : 'muted'} dot>
                  {view.twoFactorEnabled ? `${t.twoFactorOn} · ${methodName(t, view.twoFactorMethod as TwoFactorMethod)}` : t.twoFactorOff}
                </Badge>
                {view.twoFactorEnabled ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={resetTwoFactor}>{t.twoFactorReset}</Button> : null}
              </p>
              <p className="hint">{`${t.effectiveNow}: ${view.effective.required ? `${t.twoFactorModeRequired}${view.effective.method ? ` · ${methodName(t, view.effective.method)}` : ''}` : t.twoFactorOptional}`}</p>
            </div>
          ) : null}
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
