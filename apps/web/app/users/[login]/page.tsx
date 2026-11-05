'use client';

import { CircleCheck, KeyRound, Layers, Shield, Snowflake, Waypoints } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Desk, layerName } from '../../../components/desk';
import { TableSkeleton } from '../../../components/loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { GRANT_CODES, grantLabel } from '../../../lib/grants';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';
import { useRequireLayer } from '../../../lib/use-require-layer';

const OFFICE_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

type Choice = 'role' | 'allow' | 'deny';

export default function AccountPage() {
  const { t } = usePrefs();
  const params = useParams<{ login: string }>();
  const allowed = useRequireLayer(OFFICE_LAYERS);
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [extraRoleIds, setExtraRoleIds] = useState<string[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const account = useLoad(() => api.officeAccount(params.login), [params.login], { enabled: allowed });
  const row = account.data;
  const picked = choices ?? Object.fromEntries(GRANT_CODES.map((code) => {
    if (row?.deniedGrants.includes(code)) return [code, 'deny'];
    if (row?.extraGrants.includes(code)) return [code, 'allow'];
    return [code, 'role'];
  }));
  const extras = extraRoleIds ?? row?.extraRoleIds ?? [];
  const primary = roleId ?? row?.roleId ?? '';
  const { run, busy } = useAction({ setError, setNote, onDone: account.reload });

  useEffect(() => {
    setChoices(null);
    setExtraRoleIds(null);
    setRoleId(null);
  }, [account.data]);

  async function save() {
    if (!row) return;
    const extraGrants = GRANT_CODES.filter((code) => picked[code] === 'allow');
    const deniedGrants = GRANT_CODES.filter((code) => picked[code] === 'deny');
    await run(() => api.saveAccountAccess(row.loginName, {
      extraGrants,
      deniedGrants,
      extraRoleIds: extras,
      roleId: row.staff ? primary : undefined,
    }), { note: t.savedAccess });
  }

  if (!allowed) return <Desk title="" lede="" error="" note=""><span /></Desk>;

  const roleHas = new Set(row?.roleGrants ?? []);
  const title = row ? <bdi>{row.nickname}</bdi> : t.accountName;
  const jobRoles = (row?.roles ?? []).filter((role) => role.id !== primary);
  const showExtras = Boolean(row?.canEdit && (row.staff || jobRoles.length > 0));

  return (
    <Desk
      title={title}
      lede={row ? '' : ''}
      error={error || account.error}
      note={note}
    >
      {!account.loaded ? (
        <section className="pane">
          <TableSkeleton rows={4} columns={3} />
        </section>
      ) : row && (
        <div className="stack flow">
          <dl className="fact-grid">
            <div className="fact-card">
              <div><dt>{t.loginName}</dt><dd><bdi dir="ltr">{row.loginName}</bdi></dd></div>
              <span className="fact-mark" aria-hidden="true"><KeyRound /></span>
            </div>
            <div className="fact-card">
              <div><dt>{t.layer}</dt><dd>{layerName(t, row.layer)}</dd></div>
              <span className="fact-mark" aria-hidden="true"><Layers /></span>
            </div>
            <div className="fact-card">
              <div><dt>{t.parent}</dt><dd>{row.parentLogin ? <bdi dir="ltr">{row.parentLogin}</bdi> : '—'}</dd></div>
              <span className="fact-mark" aria-hidden="true"><Waypoints /></span>
            </div>
            <div className="fact-card">
              <div><dt>{t.role}</dt><dd>{row.staff ? (row.roleName || '—') : layerName(t, row.layer)}</dd></div>
              <span className="fact-mark" aria-hidden="true"><Shield /></span>
            </div>
            <div className={row.frozen ? 'fact-card warn' : 'fact-card good'}>
              <div><dt>{t.status}</dt><dd>{row.frozen ? t.frozen : t.accountOpen}</dd></div>
              <span className="fact-mark" aria-hidden="true">{row.frozen ? <Snowflake /> : <CircleCheck />}</span>
            </div>
          </dl>
          <section className="pane">
            <header className="pane-head">
              <h2><Shield aria-hidden="true" />{t.accountAccess}</h2>
            </header>
            <div className="pane-body access-sheet">
              <div className="grant-head">
                <div className="grant-line head">
                  <span>{t.permissions}</span>
                  <span>{t.status}</span>
                  <span>{row.canEdit ? t.grantChoice : ''}</span>
                </div>
                <div className="grant-line head">
                  <span>{t.permissions}</span>
                  <span>{t.status}</span>
                  <span>{row.canEdit ? t.grantChoice : ''}</span>
                </div>
              </div>
              <div className="grant-board">
              {GRANT_CODES.map((code) => {
                const fromRole = row.isBranchOwner || roleHas.has(code);
                const mode = (picked[code] ?? 'role') as Choice;
                const on = row.isBranchOwner || (mode === 'deny' ? false : mode === 'allow' ? true : fromRole);
                return (
                  <div key={code} className="grant-line">
                    <span>{grantLabel(t, code)}</span>
                    <span className={on ? 'badge' : 'badge cancelled'}>{on ? t.grantAllow : t.grantDeny}</span>
                    {row.canEdit ? (
                      <select
                        aria-label={grantLabel(t, code)}
                        value={mode}
                        onChange={(event) => setChoices({ ...picked, [code]: event.target.value as Choice })}
                      >
                        <option value="role">{t.followRole}</option>
                        <option value="allow">{t.grantAllow}</option>
                        <option value="deny">{t.grantDeny}</option>
                      </select>
                    ) : <span />}
                  </div>
                );
              })}
              </div>
              {showExtras && (
                <div className="access-block">
                  <h3>{t.extraRoles}</h3>
                  {row.staff && (
                    <label className="role-primary">
                      {t.role}
                      <select value={primary} onChange={(event) => setRoleId(event.target.value)}>
                        {row.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="grant-board">
                    {jobRoles.map((role) => (
                      <label key={role.id} className="grant-line">
                        <span>{role.name}</span>
                        <input
                          type="checkbox"
                          checked={extras.includes(role.id)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...extras, role.id]
                              : extras.filter((id) => id !== role.id);
                            setExtraRoleIds(next);
                          }}
                        />
                        <span />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {row.canEdit && (
                <div className="form-save">
                  <Button type="button" disabled={busy} onClick={save}>{t.save}</Button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </Desk>
  );
}
