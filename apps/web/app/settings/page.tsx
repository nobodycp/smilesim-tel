'use client';

import { useState, type FormEvent } from 'react';
import { PageSkeleton } from '../../components/loading';
import { RowMenu } from '../../components/row-menu';
import { api } from '../../lib/api';
import { sharedKeys } from '../../lib/query';
import { useApiQuery } from '../../lib/use-api-query';
import { citiesFor } from '../../lib/cities';
import { useOffice } from '../../lib/office-session';
import { usePageTitle } from '../../lib/page-title';
import { usePrefs } from '../../lib/prefs';
import { Alert } from '../../components/alert';
import { Badge } from '../../components/ui/badge';
import { Select } from '../../components/ui/select';
import { Button } from '../../components/ui/button';

export default function SettingsPage() {
  const { t, apiText, locale } = usePrefs();
  const { ready, refresh } = useOffice();
  usePageTitle(t.settingsTitle);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const profile = useApiQuery(sharedKeys.profile, () => api.getProfile());
  const sessionList = useApiQuery(sharedKeys.sessions, () => api.listSessions());
  const loginName = profile.data?.loginName ?? '';
  const sessions = sessionList.data?.sessions ?? [];
  // The fields start from the first answer and are the user's from then on: a later read in the background never
  // overwrites a draft. Seeded while rendering, when that first answer arrives, instead of in an effect.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && profile.data) {
    setSeeded(true);
    setNickname(profile.data.nickname ?? '');
    setEmail(profile.data.email ?? '');
    setPhone(profile.data.phone ?? '');
    setCity(profile.data.city ?? '');
    setAddress(profile.data.address ?? '');
  }

  async function saveProfile(patch: Parameters<typeof api.updateProfile>[0], done: string) {
    setError('');
    setNote('');
    const result = await api.updateProfile(patch);
    if (!result.ok) {
      setError(apiText(result));
      return false;
    }
    setNickname(result.data.nickname ?? '');
    setEmail(result.data.email ?? '');
    setPhone(result.data.phone ?? '');
    setCity(result.data.city ?? '');
    setAddress(result.data.address ?? '');
    setNote(done);
    // The shell draws the name from the session; a saved name reaches the topbar through it.
    if ('nickname' in patch) void refresh();
    return true;
  }

  const saveFullName = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ nickname }, t.savedFullName);
  };
  const saveCity = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ city }, t.savedCity);
  };
  const saveAddress = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ address }, t.savedAddress);
  };
  const saveEmail = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ email }, t.savedEmail);
  };
  const savePhone = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ phone }, t.savedPhone);
  };
  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (await saveProfile({ currentPassword, nextPassword }, t.savedPassword)) {
      setCurrentPassword('');
      setNextPassword('');
    }
  }

  async function startTwoFactor() {
    setError('');
    setNote('');
    const result = await api.setupTwoFactor();
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    setTwoFactorCode('');
    setOtpauth(result.data.otpauth);
  }

  async function confirmTwoFactor(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNote('');
    const result = await api.confirmTwoFactor(twoFactorCode);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    setOtpauth('');
    setTwoFactorCode('');
    setNote(t.enabledTwoFactor);
  }

  async function revoke(id: string) {
    setError('');
    const result = await api.revokeSession(id);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    await sessionList.reload();
  }

  const when = (value: string) => {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const shownName = nickname || loginName;
  const initial = (shownName || t.brand).trim().charAt(0);
  const cities = citiesFor(locale);

  if (!ready) return <PageSkeleton />;

  return (
    <div className="settings-page desk">
    <header className="page-head">
      <h1>{t.settingsTitle}</h1>
      <p className="lede">{t.settingsLede}</p>
    </header>
    <Alert banner>{error || profile.error || sessionList.error}</Alert>
    <Alert tone="success" banner>{note}</Alert>

    <div className="settings-grid">
      <div className="settings-col">
        <section className="pane">
          <header className="pane-head"><h2>{t.account}</h2></header>
          <div className="pane-body">
            <div className="identity">
              <div className="identity-mark" aria-hidden="true">{initial}</div>
              <div>
                <strong><bdi>{shownName}</bdi></strong>
                {nickname && nickname !== loginName ? <small>{loginName}</small> : null}
              </div>
            </div>
            <form>
              <label>
                {t.loginName}
                <input value={loginName} readOnly />
              </label>
            </form>
            <form className="field-row" onSubmit={saveFullName}>
              <label>
                {t.fullName}
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="name" />
              </label>
              <Button type="submit">{t.save}</Button>
            </form>
            <form className="field-row" onSubmit={saveEmail}>
              <label>
                {t.email}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
              </label>
              <Button type="submit">{t.save}</Button>
            </form>
            <form className="field-row" onSubmit={savePhone}>
              <label>
                {t.phone}
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
              </label>
              <Button type="submit">{t.save}</Button>
            </form>
            <form className="field-row" onSubmit={saveCity}>
              <label>
                {t.city}
                <Select value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2">
                  <option value="">{t.cityNone}</option>
                  {cities.map((row) => (
                    <option key={row.key} value={row.key}>{row[locale]}</option>
                  ))}
                </Select>
              </label>
              <Button type="submit">{t.save}</Button>
            </form>
            <form className="field-row" onSubmit={saveAddress}>
              <label>
                {t.address}
                <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} autoComplete="street-address" />
              </label>
              <Button type="submit">{t.save}</Button>
            </form>
          </div>
        </section>

        <section className="pane">
          <header className="pane-head"><h2>{t.passwordSection}</h2></header>
          <form className="pane-body" onSubmit={savePassword}>
            <div className="pair">
              <label>
                {t.currentPassword}
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" dir="ltr" />
              </label>
              <label>
                {t.newPassword}
                <input type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" dir="ltr" />
              </label>
            </div>
            <Button type="submit">{t.changePassword}</Button>
          </form>
        </section>
      </div>

      <div className="settings-col">
        <section className="pane">
          <header className="pane-head"><h2>{t.twoFactor}</h2></header>
          <div className="pane-body">
            {!otpauth && (
              <>
                <p className="hint">{t.twoFactorIdle}</p>
                <Button type="button" onClick={startTwoFactor}>{t.enableTwoFactor}</Button>
              </>
            )}
            {otpauth && (
              <form onSubmit={confirmTwoFactor}>
                <p className="hint">{t.enrollHint}</p>
                <p className="code" dir="ltr">{otpauth}</p>
                <label>
                  {t.code}
                  <input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required dir="ltr" />
                </label>
                <Button type="submit">{t.confirmEnable}</Button>
              </form>
            )}
          </div>
        </section>

        <section className="pane">
          <header className="pane-head"><h2>{t.sessions}</h2></header>
          <div className="pane-body">
            <ul className="sessions">
              {sessions.map((session) => (
                <li key={session.id}>
                  <span className="device" aria-hidden="true"><DeviceIcon /></span>
                  <span className="session-copy">
                    <strong title={session.userAgent}>
                      <bdi dir="ltr">{deviceLabel(session.userAgent)}</bdi>
                      {session.current && <Badge variant="success" dot>{t.currentSession}</Badge>}
                    </strong>
                    <small className="session-meta" dir="ltr">{session.ip} · {when(session.lastSeenAt)}</small>
                  </span>
                  <RowMenu
                    label={`${t.endSession} ${deviceLabel(session.userAgent)}`}
                    items={[{ label: t.endSession, icon: 'ban', danger: true, onClick: () => revoke(session.id) }]}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
    </div>
  );
}

function deviceLabel(agent: string) {
  if (/curl/i.test(agent)) return 'curl';
  if (/Cursor/i.test(agent)) return 'Cursor';
  if (/Edg\//.test(agent)) return 'Edge';
  if (/Chrome\//.test(agent)) return 'Chrome';
  if (/Firefox\//.test(agent)) return 'Firefox';
  if (/Safari\//.test(agent)) return 'Safari';
  return agent.slice(0, 36);
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
      <path d="M8 19.5h8M12 16.5v3" />
    </svg>
  );
}
