'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, layerName, whole } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { FilterBar } from '../../components/filter-bar';
import { TableSkeleton } from '../../components/loading';
import { RowMenu, type RowAction } from '../../components/row-menu';
import { api, type UserRow } from '../../lib/api';
import { useDoor } from '../../lib/door-context';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

const layerOrder = ['branch', 'main_agent', 'agent', 'pos'];

export default function UsersPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [op, setOp] = useState<{ login: string; kind: 'fund' | 'ceiling' | 'transfer' | 'password' | 'freeze' | 'enter' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
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

  function choose(login: string, kind: NonNullable<typeof op>['kind']) {
    setError('');
    setOp({ login, kind });
  }

  async function fund(row: UserRow) {
    if (busy) return;
    setError('');
    setNote('');
    const amount = whole(amounts[row.loginName] ?? '');
    if (amount === null || amount < 1 || (row.self && !(notes[row.loginName] ?? '').trim())) {
      setError(apiText(row.self ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      return;
    }
    setBusy(true);
    const result = await api.fundWallet(row.loginName, amount, notes[row.loginName] ?? '');
    setBusy(false);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setAmounts((current) => ({ ...current, [row.loginName]: '' }));
    setNotes((current) => ({ ...current, [row.loginName]: '' }));
    setNote(t.funded);
    setOp(null);
    await load();
  }

  async function saveCeiling(row: UserRow) {
    if (busy) return;
    setError('');
    setNote('');
    const ceiling = whole(ceilings[row.loginName] ?? '');
    if (ceiling === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    setBusy(true);
    const result = await api.setCeiling(row.loginName, ceiling);
    setBusy(false);
    if (!result.ok) setError(apiText(result.message));
    else {
      setNote(t.save);
      setOp(null);
      await load();
    }
  }

  async function createAccount() {
    if (busy) return;
    setError('');
    setNote('');
    setBusy(true);
    const result = await api.createUser({
      loginName: draft.loginName.trim(),
      nickname: draft.nickname.trim(),
      password: draft.password,
      layer: draft.layer || creatable[0],
      parentLogin: draft.parentLogin || undefined,
      roleId: draft.roleId || undefined,
    });
    setBusy(false);
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
    if (busy) return;
    setError('');
    setNote('');
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.ok) setError(apiText(result.message ?? 'حدث خطأ'));
    else {
      setOp(null);
      await load();
    }
  }

  const shown = [...rows]
    .filter((row) => !layerFilter || row.layer === layerFilter)
    .filter((row) => {
      const needle = query.trim();
      if (!needle) return true;
      return row.nickname.includes(needle) || row.loginName.includes(needle);
    })
    .sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer) || a.loginName.localeCompare(b.loginName));
  const active = op ? rows.find((row) => row.loginName === op.login) : undefined;

  function actions(row: UserRow): RowAction[] {
    const fundable = canFund(row);
    const ceilingEditable = row.directChild && row.layer !== 'branch';
    const items: RowAction[] = [];
    if (fundable) items.push({ label: t.fund, icon: 'fund', onClick: () => choose(row.loginName, 'fund') });
    if (ceilingEditable) items.push({ label: t.ceiling, icon: 'edit', onClick: () => choose(row.loginName, 'ceiling') });
    if (row.layer === 'pos' && (me?.layer === 'branch' || me?.layer === 'main_agent')) {
      items.push({ label: t.transfer, icon: 'move', onClick: () => choose(row.loginName, 'transfer') });
    }
    if (!row.self && row.layer !== 'branch' && creatable.length > 0) {
      items.push({ label: t.newPassword, icon: 'key', onClick: () => choose(row.loginName, 'password') });
    }
    if (row.canFreeze) {
      items.push({
        label: row.frozen ? t.restoreAccount : t.freezeAccount,
        icon: row.frozen ? 'undo' : 'ban',
        onClick: () => choose(row.loginName, 'freeze'),
      });
    }
    if (row.canEnter) items.push({ label: t.enterAccount, icon: 'enter', onClick: () => choose(row.loginName, 'enter') });
    if (row.canDelete) items.push({ label: t.deleteAccount, icon: 'trash', danger: true, onClick: () => choose(row.loginName, 'delete') });
    return items;
  }

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
      <FilterBar onClear={() => { setQuery(''); setLayerFilter(''); }} clearLabel={t.clearFilters}>
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
      </FilterBar>
      <section className="pane">
        <Dialog
          open={creating}
          title={t.openAccount}
          closeLabel={t.closeMenu}
          error={error}
          onClose={() => setCreating(false)}
          footer={(
            <>
              <button type="button" className="secondary" onClick={() => setCreating(false)}>{t.cancel}</button>
              <button type="button" className="primary" disabled={busy || !draft.loginName.trim() || !draft.nickname.trim() || !draft.password || ((draft.layer || creatable[0]) === 'staff' && !draft.roleId)} onClick={createAccount}>{t.save}</button>
            </>
          )}
        >
          <div className="dialog-form">
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
                  <th className="fit">{t.layer}</th>
                  <th className="fit">{t.parent}</th>
                  <th className="num">{t.balance}</th>
                  <th className="num">{t.ceiling}</th>
                  <th className="fit">{t.status}</th>
                  <th className="row-actions">{t.lineOps}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.loginName}>
                    <td>
                      <strong>{row.nickname}</strong>
                      <div className="hint"><bdi dir="ltr">{row.loginName}</bdi></div>
                    </td>
                    <td className="fit">{layerName(t, row.layer)}</td>
                    <td className="fit">{row.parentLogin ? <bdi dir="ltr">{row.parentLogin}</bdi> : '—'}</td>
                    <td className="num"><Money value={row.balance} /></td>
                    <td className="num">{row.layer === 'branch' ? '—' : <Money value={row.ceiling} />}</td>
                    <td className="fit">
                      <span className={row.frozen ? 'badge pending' : 'badge'}>{row.frozen ? t.frozen : t.accountOpen}</span>
                    </td>
                    <td className="row-actions">
                      <RowMenu label={`${t.lineOps} ${row.nickname}`} items={actions(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {active && op ? (
          <Dialog
            open
            size={op.kind === 'fund' || op.kind === 'ceiling' || op.kind === 'transfer' || op.kind === 'password' ? 'form' : 'confirm'}
            title={op.kind === 'fund' ? t.fund : op.kind === 'ceiling' ? t.ceiling : op.kind === 'transfer' ? t.transfer : op.kind === 'password' ? t.newPassword : op.kind === 'enter' ? t.enterAccount : op.kind === 'delete' ? t.deleteAccount : active.frozen ? t.restoreAccount : t.freezeAccount}
            closeLabel={t.closeMenu}
            error={error}
            onClose={() => { if (!busy) setOp(null); }}
            footer={(
              <>
                <button type="button" className="secondary" disabled={busy} onClick={() => setOp(null)}>{t.cancel}</button>
                {op.kind === 'fund' ? <button type="button" className="primary" disabled={busy} onClick={() => fund(active)}>{t.fund}</button> : null}
                {op.kind === 'ceiling' ? <button type="button" className="primary" disabled={busy} onClick={() => saveCeiling(active)}>{t.save}</button> : null}
                {op.kind === 'transfer' ? <button type="button" className="primary" disabled={busy || !dest[active.loginName]} onClick={() => run(() => api.transferPos(active.loginName, dest[active.loginName] ?? ''))}>{t.transfer}</button> : null}
                {op.kind === 'password' ? <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.setUserPassword(active.loginName, passwords[active.loginName] ?? ''))}>{t.save}</button> : null}
                {op.kind === 'freeze' ? <button type="button" className="primary" disabled={busy} onClick={() => run(() => (active.frozen ? api.restoreUser(active.loginName) : api.freezeUser(active.loginName)))}>{active.frozen ? t.restoreAccount : t.freezeAccount}</button> : null}
                {op.kind === 'enter' ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      setError('');
                      const result = await api.enterUser(active.loginName);
                      if (!result.ok) {
                        setBusy(false);
                        setError(apiText(result.message));
                        return;
                      }
                      window.location.assign('/numbers');
                    }}
                  >
                    {t.enterAccount}
                  </button>
                ) : null}
                {op.kind === 'delete' ? <button type="button" className="danger" disabled={busy} onClick={() => run(() => api.removeUser(active.loginName))}>{t.deleteAccount}</button> : null}
              </>
            )}
          >
            <div className="dialog-form">
              <p className="dialog-who">
                {active.nickname}
                {active.loginName !== active.nickname ? <bdi dir="ltr">{active.loginName}</bdi> : null}
              </p>
              {op.kind === 'fund' ? (
                <>
                  <label>
                    {t.amount}
                    <input inputMode="numeric" value={amounts[active.loginName] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [active.loginName]: event.target.value }))} />
                  </label>
                  <label>
                    {t.note}
                    <input value={notes[active.loginName] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [active.loginName]: event.target.value }))} />
                  </label>
                </>
              ) : null}
              {op.kind === 'ceiling' ? (
                <label>
                  {t.ceiling}
                  <input inputMode="numeric" value={ceilings[active.loginName] ?? ''} onChange={(event) => setCeilings((current) => ({ ...current, [active.loginName]: event.target.value }))} />
                </label>
              ) : null}
              {op.kind === 'transfer' ? (
                <label>
                  {t.transfer}
                  <select value={dest[active.loginName] ?? ''} onChange={(event) => setDest((current) => ({ ...current, [active.loginName]: event.target.value }))}>
                    <option value="">—</option>
                    {rows.filter((item) => item.layer === 'agent').map((item) => (
                      <option key={item.loginName} value={item.loginName}>{item.nickname}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {op.kind === 'password' ? (
                <label>
                  {t.newPassword}
                  <input type="password" value={passwords[active.loginName] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [active.loginName]: event.target.value }))} />
                </label>
              ) : null}
            </div>
          </Dialog>
        ) : null}
      </section>
    </Desk>
  );
}
