'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Desk, Money, layerName, whole } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { TableSkeleton } from '../../components/loading';
import { api, type UserRow } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

const layerOrder = ['branch', 'main_agent', 'agent', 'pos'];

export default function UsersPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ceilings, setCeilings] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ loginName: '', nickname: '', password: '', layer: '', parentLogin: '', roleId: '' });
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [dest, setDest] = useState<Record<string, string>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('q');
    if (value) setQuery(value);
  }, []);
  const [layerFilter, setLayerFilter] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useOffice();
  const door = useDoor();
  const allowed = door.layer !== 'pos' && !!me && me.layer !== 'pos';
  const isBranch = me?.layer === 'branch';
  const creatable = me?.layer === 'branch'
    ? ['main_agent', 'agent', 'pos', ...(me.isBranchOwner || me.grants?.includes('staff') ? ['staff'] : [])]
    : me?.layer === 'main_agent'
      ? ['agent', 'pos']
      : me?.layer === 'agent'
        ? ['pos']
        : [];
  const directLayer = me?.layer === 'branch' ? 'main_agent' : me?.layer === 'main_agent' ? 'agent' : 'pos';

  useEffect(() => {
    if (draft.layer !== 'staff' || roles.length > 0) return;
    void api.officeRoles().then((result) => { if (result.ok) setRoles(result.data.roles); });
  }, [draft.layer, roles.length]);

  const load = useCallback(async () => {
    const result = await api.officeUsers();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setRows(result.data.users);
    setCeilings((current) => {
      const next = { ...current };
      for (const row of result.data.users) next[row.loginName] ??= String(row.ceiling);
      return next;
    });
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    if (door.layer === 'pos' || (me && me.layer === 'pos')) window.location.replace('/');
  }, [door.layer, me]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  function canFund(row: UserRow) {
    if (row.self) return isBranch;
    if (isBranch) return true;
    return row.directChild;
  }

  async function fund(row: UserRow) {
    setError('');
    setNote('');
    const amount = whole(amounts[row.loginName] ?? '');
    if (amount === null || amount < 1 || (row.self && !(notes[row.loginName] ?? '').trim())) {
      setError(apiText(row.self ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      return;
    }
    const result = await api.fundWallet(row.loginName, amount, notes[row.loginName] ?? '');
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setAmounts((current) => ({ ...current, [row.loginName]: '' }));
    setNotes((current) => ({ ...current, [row.loginName]: '' }));
    setNote(t.funded);
    await load();
  }

  async function saveCeiling(row: UserRow) {
    setError('');
    setNote('');
    const ceiling = whole(ceilings[row.loginName] ?? '');
    if (ceiling === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const result = await api.setCeiling(row.loginName, ceiling);
    if (!result.ok) setError(apiText(result.message));
    else {
      setNote(t.save);
      await load();
    }
  }

  async function createAccount() {
    setError('');
    setNote('');
    const result = await api.createUser({
      loginName: draft.loginName.trim(),
      nickname: draft.nickname.trim(),
      password: draft.password,
      layer: draft.layer || creatable[0],
      parentLogin: draft.parentLogin || undefined,
      roleId: draft.roleId || undefined,
    });
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setCreating(false);
    setDraft({ loginName: '', nickname: '', password: '', layer: '', parentLogin: '', roleId: '' });
    setNote(t.openAccount);
    await load();
  }

  async function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError('');
    setNote('');
    const result = await work();
    if (!result.ok) setError(apiText(result.message ?? 'حدث خطأ'));
    else await load();
  }

  const shown = [...rows]
    .filter((row) => !layerFilter || row.layer === layerFilter)
    .filter((row) => {
      const needle = query.trim();
      if (!needle) return true;
      return row.nickname.includes(needle) || row.loginName.includes(needle);
    })
    .sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer) || a.loginName.localeCompare(b.loginName));

  if (!allowed) return <Desk title="" lede="" error="" note=""><span /></Desk>;

  return (
    <Desk
      title={t.usersTitle}
      lede=""
      action={creatable.length > 0 ? (
        <button type="button" className="primary" onClick={() => { setDraft((current) => ({ ...current, layer: creatable[0] })); setCreating(true); }}>{t.openAccount}</button>
      ) : undefined}
      error={error}
      note={note}
    >
      <div className="filter-bar">
        <div className="filter-panel">
          <label>
            {t.accountName}
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>
            {t.layer}
            <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
              <option value="">{t.allRows}</option>
              {layerOrder.map((value) => (
                <option key={value} value={value}>{layerName(t, value)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <section className="pane">
        <Dialog open={creating} title={t.openAccount} closeLabel={t.closeMenu} error={error} onClose={() => setCreating(false)}>
          <div className="account-ops">
            <label>
              {t.loginName}
              <input value={draft.loginName} dir="ltr" onChange={(event) => setDraft((current) => ({ ...current, loginName: event.target.value }))} />
            </label>
            <label>
              {t.nickname}
              <input value={draft.nickname} onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} />
            </label>
            <label>
              {t.newPassword}
              <input type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <label>
              {t.layer}
              <select value={draft.layer || creatable[0]} onChange={(event) => setDraft((current) => ({ ...current, layer: event.target.value, parentLogin: '' }))}>
                {creatable.map((value) => (
                  <option key={value} value={value}>{layerName(t, value)}</option>
                ))}
              </select>
            </label>
            {(draft.layer || creatable[0]) === 'staff' && (
              <label>
                {t.role}
                <select value={draft.roleId} onChange={(event) => setDraft((current) => ({ ...current, roleId: event.target.value }))} onFocus={() => { if (roles.length === 0) void api.officeRoles().then((result) => { if (result.ok) setRoles(result.data.roles); }); }}>
                  <option value="">—</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            )}
            {(draft.layer || creatable[0]) !== directLayer && (draft.layer || creatable[0]) !== 'staff' && (
              <label>
                {t.parent}
                <select value={draft.parentLogin} onChange={(event) => setDraft((current) => ({ ...current, parentLogin: event.target.value }))}>
                  <option value="">—</option>
                  {rows.filter((row) => row.layer === ((draft.layer || creatable[0]) === 'agent' ? 'main_agent' : 'agent')).map((row) => (
                    <option key={row.loginName} value={row.loginName}>{row.nickname}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={createAccount}>{t.save}</button>
          </div>
        </Dialog>
        {!loaded ? (
          <TableSkeleton rows={4} columns={7} />
        ) : (
          <div className="sheet">
            <table className="data">
              <thead>
                <tr>
                  <th>{t.accountName}</th>
                  <th>{t.layer}</th>
                  <th>{t.parent}</th>
                  <th>{t.balance}</th>
                  <th>{t.ceiling}</th>
                  <th>{t.status}</th>
                  <th>{t.lineOps}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const opened = open === row.loginName;
                  const fundable = canFund(row);
                  const ceilingEditable = row.directChild && row.layer !== 'branch';
                  return (
                    <Fragment key={row.loginName}>
                      <tr>
                        <td>
                          <strong>{row.nickname}</strong>
                          <div className="hint">{row.loginName}</div>
                        </td>
                        <td>{layerName(t, row.layer)}</td>
                        <td>{row.parentLogin ?? '—'}</td>
                        <td><Money value={row.balance} /></td>
                        <td>{row.layer === 'branch' ? '—' : <Money value={row.ceiling} />}</td>
                        <td>
                          <span className={row.frozen ? 'badge pending' : 'badge'}>{row.frozen ? t.frozen : t.accountOpen}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="row-menu-btn"
                            aria-label={t.lineOps}
                            aria-expanded={opened}
                            onClick={() => setOpen(opened ? null : row.loginName)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
                              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                              <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {opened && (
                        <Dialog open title={row.nickname} closeLabel={t.closeMenu} error={error} onClose={() => setOpen(null)}>
                            <div className="account-ops">
                              {fundable && (
                                <div className="account-fund">
                                  <label>
                                    {t.amount}
                                    <input
                                      inputMode="numeric"
                                      value={amounts[row.loginName] ?? ''}
                                      onChange={(event) => setAmounts((current) => ({ ...current, [row.loginName]: event.target.value }))}
                                    />
                                  </label>
                                  <label>
                                    {t.note}
                                    <input
                                      value={notes[row.loginName] ?? ''}
                                      onChange={(event) => setNotes((current) => ({ ...current, [row.loginName]: event.target.value }))}
                                    />
                                  </label>
                                  <button type="button" onClick={() => fund(row)}>{t.fund}</button>
                                </div>
                              )}
                              {ceilingEditable && (
                                <div className="account-fund">
                                  <label>
                                    {t.ceiling}
                                    <input
                                      inputMode="numeric"
                                      value={ceilings[row.loginName] ?? ''}
                                      onChange={(event) => setCeilings((current) => ({ ...current, [row.loginName]: event.target.value }))}
                                    />
                                  </label>
                                  <button type="button" onClick={() => saveCeiling(row)}>{t.save}</button>
                                </div>
                              )}
                              {row.layer === 'pos' && (me?.layer === 'branch' || me?.layer === 'main_agent') && (
                                <div className="account-fund">
                                  <label>
                                    {t.transfer}
                                    <select value={dest[row.loginName] ?? ''} onChange={(event) => setDest((current) => ({ ...current, [row.loginName]: event.target.value }))}>
                                      <option value="">—</option>
                                      {rows.filter((item) => item.layer === 'agent').map((item) => (
                                        <option key={item.loginName} value={item.loginName}>{item.nickname}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <button type="button" disabled={!dest[row.loginName]} onClick={() => run(() => api.transferPos(row.loginName, dest[row.loginName] ?? ''))}>{t.transfer}</button>
                                </div>
                              )}
                              {!row.self && row.layer !== 'branch' && creatable.length > 0 && (
                                <div className="account-fund">
                                  <label>
                                    {t.newPassword}
                                    <input
                                      type="password"
                                      value={passwords[row.loginName] ?? ''}
                                      onChange={(event) => setPasswords((current) => ({ ...current, [row.loginName]: event.target.value }))}
                                    />
                                  </label>
                                  <button type="button" onClick={() => run(() => api.setUserPassword(row.loginName, passwords[row.loginName] ?? ''))}>{t.save}</button>
                                </div>
                              )}
                              <div className="ops">
                                {row.canFreeze && (
                                  <button type="button" onClick={() => run(() => (row.frozen ? api.restoreUser(row.loginName) : api.freezeUser(row.loginName)))}>
                                    {row.frozen ? t.restoreAccount : t.freezeAccount}
                                  </button>
                                )}
                                {row.canEnter && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const result = await api.enterUser(row.loginName);
                                      if (!result.ok) setError(apiText(result.message));
                                      else window.location.assign('/numbers');
                                    }}
                                  >
                                    {t.enterAccount}
                                  </button>
                                )}
                                {row.canDelete && (
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                      if (window.confirm(`${t.deleteAccount} ${row.loginName}`)) run(() => api.removeUser(row.loginName));
                                    }}
                                  >
                                    {t.deleteAccount}
                                  </button>
                                )}
                              </div>
                            </div>
                        </Dialog>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Desk>
  );
}
