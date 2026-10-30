'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { OfficeShell } from '../../components/office-shell';
import { api, type SessionInfo } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function SettingsPage() {
  const { t, locale, apiText } = usePrefs();
  const [loginName, setLoginName] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const loadSessions = useCallback(async () => {
    const result = await api.listSessions();
    if (result.ok) setSessions(result.data.sessions);
    else setError(apiText(result.message));
  }, [apiText]);

  const loadProfile = useCallback(async () => {
    const result = await api.getProfile();
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setLoginName(result.data.loginName);
    setNickname(result.data.nickname ?? '');
    setEmail(result.data.email ?? '');
    setPhone(result.data.phone ?? '');
  }, [apiText]);

  useEffect(() => {
    loadProfile();
    loadSessions();
  }, [loadProfile, loadSessions]);

  async function saveProfile(patch: Parameters<typeof api.updateProfile>[0], done: string) {
    setError('');
    setNote('');
    const result = await api.updateProfile(patch);
    if (!result.ok) {
      setError(apiText(result.message));
      return false;
    }
    setNickname(result.data.nickname ?? '');
    setEmail(result.data.email ?? '');
    setPhone(result.data.phone ?? '');
    setNote(done);
    return true;
  }

  const saveNickname = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ nickname }, t.savedNickname);
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
      setError(apiText(result.message));
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
      setError(apiText(result.message));
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
      setError(apiText(result.message));
      return;
    }
    await loadSessions();
  }

  const when = (value: string) => new Date(value).toLocaleString(locale === 'en' ? 'en' : locale);
  const shownName = nickname || loginName;
  const initial = (shownName || t.brand).trim().charAt(0);

  return (
    <OfficeShell account={shownName} hint={nickname ? loginName : undefined} wide>
      <div className="settings-page desk">
      <header className="page-head">
        <h1>{t.settingsTitle}</h1>
        <p className="lede">{t.settingsLede}</p>
      </header>
      {error && <p className="error banner" role="alert">{error}</p>}
      {note && <p className="note banner" role="status">{note}</p>}

      <div className="settings-grid">
        <div className="settings-col">
          <section className="pane">
            <header className="pane-head"><h2>{t.account}</h2></header>
            <div className="pane-body">
              <div className="identity">
                <div className="identity-mark" aria-hidden="true">{initial}</div>
                <div>
                  <strong>{shownName}</strong>
                  {nickname && nickname !== loginName ? <small>{loginName}</small> : null}
                </div>
              </div>
              <form>
                <label>
                  {t.loginName}
                  <input value={loginName} readOnly />
                </label>
              </form>
              <form className="field-row" onSubmit={saveNickname}>
                <label>
                  {t.nickname}
                  <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
                </label>
                <button type="submit">{t.save}</button>
              </form>
              <form className="field-row" onSubmit={saveEmail}>
                <label>
                  {t.email}
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </label>
                <button type="submit">{t.save}</button>
              </form>
              <form className="field-row" onSubmit={savePhone}>
                <label>
                  {t.phone}
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
                </label>
                <button type="submit">{t.save}</button>
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
              <button type="submit">{t.changePassword}</button>
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
                  <button type="button" className="btn-sm" onClick={startTwoFactor}>{t.enableTwoFactor}</button>
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
                  <button type="submit">{t.confirmEnable}</button>
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
                        <span>{deviceLabel(session.userAgent)}</span>
                        {session.current && <span className="badge">{t.currentSession}</span>}
                      </strong>
                      <small>{session.ip} · {when(session.lastSeenAt)}</small>
                    </span>
                    <button type="button" className="quiet" onClick={() => revoke(session.id)}>{t.endSession}</button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
      </div>
    </OfficeShell>
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
