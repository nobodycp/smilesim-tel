'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type SessionInfo } from '../../lib/api';

export default function SettingsPage() {
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
    else setError(result.message);
  }, []);

  const loadProfile = useCallback(async () => {
    const result = await api.getProfile();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLoginName(result.data.loginName);
    setNickname(result.data.nickname ?? '');
    setEmail(result.data.email ?? '');
    setPhone(result.data.phone ?? '');
  }, []);

  useEffect(() => {
    loadProfile();
    loadSessions();
  }, [loadProfile, loadSessions]);

  async function saveProfile(patch: Parameters<typeof api.updateProfile>[0], done: string) {
    setError('');
    setNote('');
    const result = await api.updateProfile(patch);
    if (!result.ok) {
      setError(result.message);
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
    return saveProfile({ nickname }, 'تم حفظ النيك نيم');
  };
  const saveEmail = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ email }, 'تم حفظ البريد');
  };
  const savePhone = (e: FormEvent) => {
    e.preventDefault();
    return saveProfile({ phone }, 'تم حفظ الهاتف');
  };
  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (await saveProfile({ currentPassword, nextPassword }, 'تم تغيير كلمة السر')) {
      setCurrentPassword('');
      setNextPassword('');
    }
  }

  async function startTwoFactor() {
    setError('');
    setNote('');
    const result = await api.setupTwoFactor();
    if (!result.ok) {
      setError(result.message);
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
      setError(result.message);
      return;
    }
    setOtpauth('');
    setTwoFactorCode('');
    setNote('تم تفعيل التحقق بخطوتين');
  }

  async function revoke(id: string) {
    setError('');
    const result = await api.revokeSession(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await loadSessions();
  }

  return (
    <>
      <h1>الإعدادات</h1>
      <p className="lede">حسابك وجلساتك.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="note" role="status">{note}</p>}

      <h2>الحساب</h2>
      <form>
        <label>
          اسم الدخول
          <input value={loginName} readOnly />
        </label>
      </form>
      <form onSubmit={saveNickname}>
        <label>
          النيك نيم
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <button type="submit">حفظ النيك نيم</button>
      </form>
      <form onSubmit={saveEmail}>
        <label>
          البريد
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </label>
        <button type="submit">حفظ البريد</button>
      </form>
      <form onSubmit={savePhone}>
        <label>
          الهاتف
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
        </label>
        <button type="submit">حفظ الهاتف</button>
      </form>

      <h2>كلمة السر</h2>
      <form onSubmit={savePassword}>
        <label>
          كلمة السر الحالية
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <label>
          كلمة السر الجديدة
          <input type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <button type="submit">تغيير كلمة السر</button>
      </form>

      <h2>التحقق بخطوتين</h2>
      {!otpauth && (
        <button type="button" onClick={startTwoFactor}>تفعيل التحقق بخطوتين</button>
      )}
      {otpauth && (
        <form onSubmit={confirmTwoFactor}>
          <p className="lede">أضف الرابط التالي إلى تطبيق المصادقة ثم أدخل الرمز.</p>
          <p className="code" dir="ltr">{otpauth}</p>
          <label>
            الرمز
            <input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
          </label>
          <button type="submit">تأكيد التفعيل</button>
        </form>
      )}

      <h2>الجلسات</h2>
      <ul className="sessions">
        {sessions.map((session) => (
          <li key={session.id}>
            <span>
              {session.current && <span className="badge">الجلسة الحالية</span>}
              <small>{session.userAgent}</small>
              <small>{session.ip} · {new Date(session.lastSeenAt).toLocaleString('ar')}</small>
            </span>
            <button type="button" className="danger" onClick={() => revoke(session.id)}>إنهاء</button>
          </li>
        ))}
      </ul>
    </>
  );
}
