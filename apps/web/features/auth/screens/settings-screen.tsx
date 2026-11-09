'use client';

import { useState, type FormEvent } from 'react';
import { PageSkeleton } from '../../../components/loading';
import { api } from '../../../lib/api';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { citiesFor } from '../../../lib/cities';
import { useOffice } from '../../../lib/office-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { PasskeysPane, TwoFactorPane, useSignInMethods } from '../sign-in-methods';
import { LayerSessionRulesPane } from '../session-rules';

export function SettingsScreen() {
  const { t, apiText, locale } = usePrefs();
  const { ready, refresh, me } = useOffice();
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

  const profile = useApiQuery(sharedKeys.profile, () => api.getProfile());
  const sessionList = useApiQuery(sharedKeys.sessions, () => api.listSessions());
  const methods = useSignInMethods();
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

  // One «حفظ» for the account card, as in the design: it sends only the fields that changed.
  const saveAccount = (e: FormEvent) => {
    e.preventDefault();
    const was = profile.data;
    const patch: Parameters<typeof api.updateProfile>[0] = {};
    if (nickname !== (was?.nickname ?? '')) patch.nickname = nickname;
    if (email !== (was?.email ?? '')) patch.email = email;
    if (phone !== (was?.phone ?? '')) patch.phone = phone;
    if (city !== (was?.city ?? '')) patch.city = city;
    if (address !== (was?.address ?? '')) patch.address = address;
    if (Object.keys(patch).length === 0) {
      setNote(t.savedProfile);
      return;
    }
    void saveProfile(patch, t.savedProfile).then((ok) => (ok ? profile.reload() : undefined));
  };
  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (await saveProfile({ currentPassword, nextPassword }, t.savedPassword)) {
      setCurrentPassword('');
      setNextPassword('');
    }
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
    <Alert banner>{error || profile.error || sessionList.error || methods.error}</Alert>
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
                <small className="identity-login" dir="ltr">{loginName}</small>
              </div>
            </div>
            <form className="account-form" onSubmit={saveAccount}>
              <label>
                {t.fullName}
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="name" />
              </label>
              <div className="pair">
                <label>
                  {t.email}
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </label>
                <label>
                  {t.phone}
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="05x xxx xxxx" />
                </label>
              </div>
              <div className="pair">
                <label>
                  {t.city}
                  <Select value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2">
                    <option value="">{t.cityNone}</option>
                    {cities.map((row) => (
                      <option key={row.key} value={row.key}>{row[locale]}</option>
                    ))}
                  </Select>
                </label>
                <label>
                  {t.address}
                  <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} autoComplete="street-address" />
                </label>
              </div>
              <div><Button type="submit">{t.save}</Button></div>
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
            <div><Button type="submit" variant="secondary">{t.changePassword}</Button></div>
          </form>
        </section>
      </div>

      <div className="settings-col">
        <TwoFactorPane methods={methods.data} reload={methods.reload} setError={setError} setNote={setNote} />
        <PasskeysPane methods={methods.data} reload={methods.reload} setError={setError} setNote={setNote} when={when} />

        <section className="pane">
          <header className="pane-head"><h2>{t.sessions}</h2>{sessions.length ? <span className="hint">{t.sessionsOpenMeta.replace('{n}', String(sessions.length))}</span> : null}</header>
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
                  <Button type="button" variant="ghost" size="sm" aria-label={`${t.endSession} ${deviceLabel(session.userAgent)}`} onClick={() => void revoke(session.id)}>
                    {t.endSession}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {me?.isBranchOwner && !me.impersonating ? <LayerSessionRulesPane setError={setError} setNote={setNote} /> : null}
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
