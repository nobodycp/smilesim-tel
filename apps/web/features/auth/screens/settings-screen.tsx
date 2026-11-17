'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PageSkeleton } from '../../../components/loading';
import { api } from '../../../lib/api';
import { sharedKeys } from '../../../lib/query';
import { useApiQuery } from '../../../lib/use-api-query';
import { citiesFor } from '../../../lib/cities';
import { useDesk } from '../../../lib/desk-session';
import { usePageTitle } from '../../../lib/page-title';
import { usePrefs } from '../../../lib/prefs';
import { Alert } from '../../../components/alert';
import { useToasts } from '../../../components/toast';
import { Badge } from '../../../components/ui/badge';
import { Select, SelectItem } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { PasskeysPane, TwoFactorPane, deviceClass, sessionClass, useSignInMethods } from '../sign-in-methods';

export function SettingsScreen() {
  const { t, apiText, locale } = usePrefs();
  const { ready, refresh } = useDesk();
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
  // Saved: a toast in the corner, the page does not move (owner 2026-11-11).
  const { push } = useToasts();
  useEffect(() => {
    if (note) push(note, 'success');
  }, [note, push]);

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

  // The desk frame (`.desk`, `.page-head`) and the panes (`.pane`, `.pane-head`, `.pane-body`) are base rules in
  // app/tailwind.css; the profile page's own parts are utilities.
  return (
    <div className="desk">
    <header className="page-head">
      <h1>{t.settingsTitle}</h1>
      <p className="lede" data-testid="page-lede">{t.settingsLede}</p>
    </header>
    <Alert banner>{error || profile.error || sessionList.error || methods.error}</Alert>

    <div className={settingsClass.grid} data-testid="settings-grid">
      <div className={settingsClass.col}>
        <section className="pane w-full">
          <header className="pane-head"><h2>{t.account}</h2></header>
          <div className="pane-body">
            <div className="flex items-center gap-3 border-b border-line-soft pb-3">
              <div className="grid size-11 flex-none place-items-center rounded-sm bg-accent-fill text-2xl font-bold text-on-accent shadow-none" aria-hidden="true">{initial}</div>
              <div>
                <strong className="block text-lg leading-1-2"><bdi>{shownName}</bdi></strong>
                <small className="text-chip text-muted" data-testid="identity-login" dir="ltr">{loginName}</small>
              </div>
            </div>
            <form className={paneForm} onSubmit={saveAccount}>
              <Label tone="pane">
                {t.fullName}
                <Input surface="surface" className="text-md" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="name" />
              </Label>
              <div className={settingsClass.pair}>
                <Label tone="pane">
                  {t.email}
                  <Input surface="surface" className="text-md" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </Label>
                <Label tone="pane">
                  {t.phone}
                  <Input surface="surface" className="text-md" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="05x xxx xxxx" />
                </Label>
              </div>
              <div className={settingsClass.pair}>
                <Label tone="pane">
                  {t.city}
                  <Select place="pane" value={city} onValueChange={setCity} autoComplete="address-level2">
                    <SelectItem value="">{t.cityNone}</SelectItem>
                    {cities.map((row) => (
                      <SelectItem key={row.key} value={row.key}>{row[locale]}</SelectItem>
                    ))}
                  </Select>
                </Label>
                <Label tone="pane">
                  {t.address}
                  <Input surface="surface" className="text-md" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} autoComplete="street-address" />
                </Label>
              </div>
              <div><Button type="submit">{t.save}</Button></div>
            </form>
          </div>
        </section>

        <section className="pane w-full">
          <header className="pane-head"><h2>{t.passwordSection}</h2></header>
          {/* `.pane form`'s 8px gap outranked `.pane-body`'s 12px. */}
          <form className="pane-body gap-2" onSubmit={savePassword}>
            <div className={settingsClass.pair}>
              <Label tone="pane">
                {t.currentPassword}
                <Input surface="surface" className="text-md" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" dir="ltr" />
              </Label>
              <Label tone="pane">
                {t.newPassword}
                <Input surface="surface" className="text-md" type="password" value={nextPassword} onChange={(e) => setNextPassword(e.target.value)} autoComplete="new-password" dir="ltr" />
              </Label>
            </div>
            <div><Button type="submit">{t.changePassword}</Button></div>
          </form>
        </section>
      </div>

      <div className={settingsClass.col}>
        <TwoFactorPane methods={methods.data} reload={methods.reload} setError={setError} setNote={setNote} />
        <PasskeysPane methods={methods.data} reload={methods.reload} setError={setError} setNote={setNote} when={when} />

        <section className="pane w-full">
          <header className="pane-head">
            <h2>{t.sessions}</h2>
            {sessions.length ? <span className="m-0 ms-auto text-sm text-muted">{t.sessionsOpenMeta.replace('{n}', String(sessions.length))}</span> : null}
          </header>
          <div className="pane-body">
            <ul className={sessionClass.list}>
              {sessions.map((session) => (
                <li key={session.id} className={sessionClass.row}>
                  <span className={deviceClass} aria-hidden="true"><DeviceIcon /></span>
                  <span className={sessionClass.copy}>
                    <strong className={sessionClass.name} title={session.userAgent}>
                      <bdi dir="ltr">{deviceLabel(session.userAgent)}</bdi>
                      {session.current && <Badge variant="success" dot>{t.currentSession}</Badge>}
                    </strong>
                    <small className={sessionClass.meta} dir="ltr">{session.ip} · {when(session.lastSeenAt)}</small>
                  </span>
                  <Button type="button" variant="ghost" size="sm" aria-label={`${t.endSession} ${deviceLabel(session.userAgent)}`} onClick={() => void revoke(session.id)}>
                    {t.endSession}
                  </Button>
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

/*
 * The profile page's layout:
 * the two columns (1.2fr and at least 280px) from 960px, each a 12px stack sized to its panes; the field pairs one
 * column under 768px. The identity row: a 44px crimson square with the initial, the name 15px over the login 12.5px.
 */
const settingsClass = {
  grid: 'grid flex-1 grid-rows-none content-start gap-3 min-[960px]:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] min-[960px]:items-stretch',
  col: 'grid grid-rows-none content-start gap-3',
  pair: 'grid grid-cols-2 gap-2 max-md:grid-cols-1',
} as const;
/** A form in a pane: a grid, 8px apart, its rows at the top. */
const paneForm = 'grid content-start gap-2';

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
    <svg className="size-3.75" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
      <path d="M8 19.5h8M12 16.5v3" />
    </svg>
  );
}
