'use client';

import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert } from '../../components/alert';
import { api, type SessionRuleValues } from '../../lib/api';
import type { LayerKey, TwoFactorMethod, TwoFactorMode } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { RuleSelects, durationLabel, sessionRulesValid } from '../auth/session-rules';
import { methodName } from '../auth/sign-in-methods';
import { MethodField, ModeSeg, savableMethod } from '../auth/two-factor-policy';

/**
 * «إعدادات الحساب» (spec 2026-11-08-overview-and-reports-nav, H), branch owner only: this account's email and
 * mobile, its two-step verification, a new password and its session rules. Since spec 2026-11-11-ui-consistency-pass
 * (D3) it is the open top of the user page's «الإعدادات والصلاحيات» tab, not a dialog behind a menu.
 * Two-step (spec 2026-11-11-two-factor-policy): follow the layer's rule, required of this account (with its own method
 * or the layer's), or optional; «إعادة تعيين» clears the account's enrolment so it enrols again.
 */
/*
 * The look (Tailwind migration T4.2, ADR 0022), ported from graphite.css `.settings-block` / `.user-settings` /
 * `.two-factor-block` / `.tf-status`, desk/users.css `.access-tab > .settings-block` / `.access-tab .field-title` and
 * desk/pane.css `.pair` / `.form-save` / the pane's labels, fields and hints, in their cascade order. The block is the top
 * of the user page's access tab: a column 12px apart, ruled off from the permissions under it (12px, a 1px `--rd-line`
 * rule) with no other padding; its title 13.5px ink bold; its lede tucked 8px up under it, 12.5px `--rd-muted` 500 at
 * 1.55 line height (so is the two-step block's); every other hint 12px `--rd-muted`; the field pairs two equal columns
 * 8px apart (one under 768px); the two-step and session blocks columns 12px apart under a 12px ink-2 bold title; the
 * two-step state and its reset one wrapping row 10px apart; the save at the reading start over a 1px `--rd-line` rule,
 * 4px and 12px above it. The labels and fields are the pane's (`Label tone="pane"`, `Input surface="surface"` at 13px).
 */
const PAIR = 'grid grid-cols-2 gap-2 max-md:grid-cols-1';
const HINT = 'm-0 text-sm text-muted';
const LEDE = '-mt-2 mb-0 text-chip leading-1-55 font-medium text-muted';
const BLOCK = 'grid gap-3';
const BLOCK_TITLE = 'text-sm font-bold text-ink-2';
const FIELD = 'text-md';

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
      // Required with no method of its own follows the layer's; when the layer's is switched off, the account is
      // given one the screens offer (the API refuses a method that cannot be carried out).
      const own = rule.method ? savableMethod(rule.method) : layerMethod && savableMethod(layerMethod.method) !== layerMethod.method ? savableMethod(layerMethod.method) : null;
      const saved = await api.setAccountTwoFactor(loginName, { mode: rule.mode, method: rule.mode === 'required' ? own : null });
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
    <section className="grid gap-3 border-b border-line pb-3" aria-label={t.userSettings}>
      <h3 className="m-0 text-block font-bold text-ink">{t.userSettings}</h3>
      <p className={LEDE}>{t.userSettingsHint}</p>
      <Alert banner>{error || settings.error || rules.error}</Alert>
      {view ? (
        <>
          <div className={PAIR}>
            <Label tone="pane">
              {t.email}
              <Input surface="surface" className={FIELD} type="email" dir="ltr" value={email ?? view.email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </Label>
            <Label tone="pane">
              {t.phone}
              <Input surface="surface" className={FIELD} type="tel" dir="ltr" value={phone ?? view.phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" />
            </Label>
          </div>
          <div className={PAIR}>
            <Label tone="pane">
              {t.newPassword}
              <Input surface="surface" className={FIELD} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <span className={HINT}>{t.passwordKeep}</span>
            </Label>
          </div>
          {ruleNow ? (
            <div className={BLOCK}>
              <span className={BLOCK_TITLE}>{t.twoFactor}</span>
              <p className={LEDE}>{t.accountTwoFactorHint}</p>
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
              <p className="m-0 flex flex-wrap items-center gap-2.5">
                <Badge variant={view.twoFactorEnabled ? 'success' : 'muted'} dot>
                  {view.twoFactorEnabled ? `${t.twoFactorOn} · ${methodName(t, view.twoFactorMethod as TwoFactorMethod)}` : t.twoFactorOff}
                </Badge>
                {view.twoFactorEnabled ? <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={resetTwoFactor}>{t.twoFactorReset}</Button> : null}
              </p>
              <p className={HINT}>{`${t.effectiveNow}: ${view.effective.required ? `${t.twoFactorModeRequired}${view.effective.method ? ` · ${methodName(t, view.effective.method)}` : ''}` : t.twoFactorOptional}`}</p>
            </div>
          ) : null}
          {ruleView ? (
            <div className={BLOCK}>
              <span className={BLOCK_TITLE}>{t.sessions}</span>
              <RuleSelects values={ruleValues} fallback={ruleView.layer} fallbackLabel={t.followLayer} onChange={setDraft} />
              <p className={HINT}>{`${t.effectiveNow}: ${t.maxSessionsLabel} ${ruleView.effective.maxSessions} · ${durationLabel(locale, ruleView.effective.sessionMinutes)}`}</p>
            </div>
          ) : null}
          <div className="mt-1 flex justify-start border-t border-line pt-3"><Button type="button" disabled={busy || !sessionRulesValid(ruleValues)} onClick={save}>{t.save}</Button></div>
        </>
      ) : null}
    </section>
  );
}
