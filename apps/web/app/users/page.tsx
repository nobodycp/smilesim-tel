'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AccountName, accountLabel } from '../../components/account-name';
import { DataTable, type Column } from '../../components/data-table';
import { Desk, Money, layerName } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { FilterBar } from '../../components/filter-bar';
import { RowMenu, type RowAction } from '../../components/row-menu';
import { TransferDialog } from '../../components/transfer-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api, type UserRow } from '../../lib/api';
import { parseShekel } from '../../lib/money';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useDebouncedField, useUrlFilters } from '../../lib/url-state';
import { useLoad } from '../../lib/use-load';
import { useRequireLayer } from '../../lib/use-require-layer';

const layerOrder = ['branch', 'main_agent', 'agent', 'pos'];
// Everyone but a point of sale; a staff account opens the desk through the branch door.
const OFFICE_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

const FILTER_KEYS = ['q', 'layer'] as const;

export default function UsersPage() {
  const { t, apiText } = usePrefs();
  const [op, setOp] = useState<{ login: string; kind: 'fund' | 'ceiling' | 'password' | 'freeze' | 'enter' | 'delete' } | null>(null);
  // The login of the account being moved; its own dialog asks for the destination and the choices.
  const [moving, setMoving] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ceilings, setCeilings] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ loginName: '', nickname: '', password: '', layer: '', parentLogin: '', roleId: '' });
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  // The filters live in the address (`?q=…&layer=pos`): the shell search can open this page filtered, even from it.
  // The list filters on what is typed at once; the address follows after a pause.
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const layerFilter = filters.layer;
  const commitQuery = useCallback((value: string) => setFilters({ q: value }), [setFilters]);
  const [query, setQuery] = useDebouncedField(filters.q, commitQuery);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useOffice();
  const allowed = useRequireLayer(OFFICE_LAYERS);
  const accounts = useLoad(() => api.officeUsers(), [], { enabled: allowed });
  const rows = accounts.data?.users ?? [];
  const roles = useLoad(() => api.officeRoles(), [], { enabled: draft.layer === 'staff' }).data?.roles ?? [];
  const { run: send, busy } = useAction({ setError, setNote, onDone: accounts.reload });
  const failure = error;
  const isBranch = me?.layer === 'branch';
  const creatable = me?.layer === 'branch'
    ? ['main_agent', 'agent', 'pos', ...(me.isBranchOwner || me.grants?.includes('staff') ? ['staff'] : [])]
    : me?.layer === 'main_agent'
      ? ['agent', 'pos']
      : me?.layer === 'agent'
        ? ['pos']
        : [];
  const directLayer = me?.layer === 'branch' ? 'main_agent' : me?.layer === 'main_agent' ? 'agent' : 'pos';
  // Moving a point of sale and moving an agent are two grants. A stopped transfer, or a session that entered
  // another account, moves nothing: the server refuses it, so the action is not offered.
  const canMove = Boolean(me && !me.stops.includes('transfer') && !me.impersonating);
  const canMovePos = canMove && Boolean(me?.grants.includes('transferPos'));
  const canMoveAgent = canMove && Boolean(me?.grants.includes('transferAgents'));

  // A ceiling the user has not touched follows the list; one they typed stays until it is saved.
  useEffect(() => {
    if (!accounts.data) return;
    setCeilings((current) => {
      const next = { ...current };
      for (const row of accounts.data?.users ?? []) next[row.loginName] ??= String(row.ceiling);
      return next;
    });
  }, [accounts.data]);

  function canFund(row: UserRow) {
    if (row.self) return isBranch;
    if (isBranch) return true;
    return row.directChild;
  }

  function choose(login: string, kind: NonNullable<typeof op>['kind']) {
    setError('');
    setOp({ login, kind });
  }

  // Every account operation closes its dialog when it succeeds.
  function run(work: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) {
    return send(work, { then: () => setOp(null) });
  }

  async function fund(row: UserRow) {
    const amount = parseShekel(amounts[row.loginName] ?? '');
    if (amount === null || amount < 1 || (row.self && !(notes[row.loginName] ?? '').trim())) {
      setError(apiText(row.self ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      setNote('');
      return;
    }
    await send(() => api.fundWallet(row.loginName, amount, notes[row.loginName] ?? ''), {
      note: t.funded,
      then: () => {
        setAmounts((current) => ({ ...current, [row.loginName]: '' }));
        setNotes((current) => ({ ...current, [row.loginName]: '' }));
        setOp(null);
      },
    });
  }

  async function saveCeiling(row: UserRow) {
    const ceiling = parseShekel(ceilings[row.loginName] ?? '');
    if (ceiling === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await send(() => api.setCeiling(row.loginName, ceiling), { note: t.save, then: () => setOp(null) });
  }

  async function createAccount() {
    await send(
      () => api.createUser({
        loginName: draft.loginName.trim(),
        nickname: draft.nickname.trim(),
        password: draft.password,
        layer: draft.layer || creatable[0],
        parentLogin: draft.parentLogin || undefined,
        roleId: draft.roleId || undefined,
      }),
      {
        note: t.openAccount,
        then: () => {
          setCreating(false);
          setDraft({ loginName: '', nickname: '', password: '', layer: '', parentLogin: '', roleId: '' });
        },
      },
    );
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
  // A point of sale moves under another agent, an agent under another main agent: never to the parent it already
  // has, and never to a frozen account.
  const moveRow = moving ? rows.find((row) => row.loginName === moving) ?? null : null;
  const destinations = moveRow
    ? rows.filter((row) => row.layer === (moveRow.layer === 'pos' ? 'agent' : 'main_agent') && row.loginName !== moveRow.parentLogin && !row.frozen)
    : [];

  function actions(row: UserRow): RowAction[] {
    const fundable = canFund(row);
    const ceilingEditable = row.directChild && row.layer !== 'branch';
    const items: RowAction[] = [];
    if (fundable) items.push({ label: t.fund, icon: 'fund', onClick: () => choose(row.loginName, 'fund') });
    if (ceilingEditable) items.push({ label: t.ceiling, icon: 'edit', onClick: () => choose(row.loginName, 'ceiling') });
    if ((row.layer === 'pos' && canMovePos) || (row.layer === 'agent' && canMoveAgent)) {
      items.push({ label: t.transfer, icon: 'move', onClick: () => { setError(''); setMoving(row.loginName); } });
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

  const columns: Column<UserRow>[] = [
    {
      key: 'account',
      header: t.accountName,
      render: (row) => (
        <Link className="row-link account-cell" href={`/users/${row.loginName}`}>
          <span className="account-mark" aria-hidden="true">{row.nickname.trim().charAt(0) || '?'}</span>
          <strong className="account-id"><AccountName login={row.loginName} name={row.nickname} /></strong>
        </Link>
      ),
    },
    { key: 'layer', header: t.layer, fit: true, render: (row) => layerName(t, row.layer) },
    { key: 'parent', header: t.parent, fit: true, render: (row) => <AccountName login={row.parentLogin} /> },
    { key: 'balance', header: t.balance, num: true, render: (row) => <Money value={row.balance} /> },
    { key: 'ceiling', header: t.ceiling, num: true, render: (row) => (row.layer === 'branch' ? '—' : <Money value={row.ceiling} />) },
    {
      key: 'status',
      header: t.status,
      fit: true,
      render: (row) => (
        <Badge variant={row.frozen ? 'warning' : 'success'} dot>
          {row.frozen ? t.frozen : t.accountOpen}
        </Badge>
      ),
    },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => <RowMenu label={`${t.rowActions} ${accountLabel(row.loginName, row.nickname)}`} items={actions(row)} />,
    },
  ];

  if (!allowed) return <Desk title="" lede="" error="" note=""><span /></Desk>;

  return (
    <Desk
      title={t.usersTitle}
      lede={t.usersLede}
      action={creatable.length > 0 ? (
        <Button type="button" onClick={() => { setDraft((current) => ({ ...current, layer: creatable[0] })); setCreating(true); }}>
          <Plus size={16} aria-hidden="true" />
          {t.openAccount}
        </Button>
      ) : undefined}
      error={failure}
      note={note}
    >
      <FilterBar onClear={() => { setQuery(''); setFilters({ q: '', layer: '' }); }} clearLabel={t.clearFilters}>
        <label>
          {t.accountName}
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          {t.layer}
          <Select value={layerFilter} onChange={(event) => setFilters({ layer: event.target.value })}>
            <option value="">{t.allRows}</option>
            {layerOrder.map((value) => (
              <option key={value} value={value}>{layerName(t, value)}</option>
            ))}
          </Select>
        </label>
      </FilterBar>
      <section className="pane fit">
        <header className="pane-head">
          <h2>{t.usersList}{accounts.loaded ? <span className="count">{shown.length}</span> : null}</h2>
        </header>
        <Dialog
          open={creating}
          title={t.openAccount}
          lede={t.openAccountHint}
          mark="plus"
          closeLabel={t.closeMenu}
          error={failure}
          onClose={() => setCreating(false)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>{t.cancel}</Button>
              <Button type="button" disabled={busy || !draft.loginName.trim() || !draft.nickname.trim() || !draft.password || ((draft.layer || creatable[0]) === 'staff' && !draft.roleId)} onClick={createAccount}>{t.save}</Button>
            </>
          )}
        >
          <div className="dialog-form">
            <label>
              {t.loginName}
              <input value={draft.loginName} dir="ltr" onChange={(event) => setDraft((current) => ({ ...current, loginName: event.target.value }))} />
            </label>
            <label>
              {t.fullName}
              <input value={draft.nickname} autoComplete="off" onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} />
            </label>
            <label>
              {t.newPassword}
              <input type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <label>
              {t.layer}
              <Select value={draft.layer || creatable[0]} onChange={(event) => setDraft((current) => ({ ...current, layer: event.target.value, parentLogin: '' }))}>
                {creatable.map((value) => (
                  <option key={value} value={value}>{layerName(t, value)}</option>
                ))}
              </Select>
            </label>
            {(draft.layer || creatable[0]) === 'staff' && (
              <label>
                {t.role}
                <Select value={draft.roleId} onChange={(event) => setDraft((current) => ({ ...current, roleId: event.target.value }))}>
                  <option value="">—</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </Select>
              </label>
            )}
            {(draft.layer || creatable[0]) !== directLayer && (draft.layer || creatable[0]) !== 'staff' && (
              <label>
                {t.parent}
                <Select value={draft.parentLogin} onChange={(event) => setDraft((current) => ({ ...current, parentLogin: event.target.value }))}>
                  <option value="">—</option>
                  {rows.filter((row) => row.layer === ((draft.layer || creatable[0]) === 'agent' ? 'main_agent' : 'agent')).map((row) => (
                    <option key={row.loginName} value={row.loginName}>{accountLabel(row.loginName, row.nickname)}</option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </Dialog>
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(row) => row.loginName}
          loading={!accounts.loaded}
          failed={accounts.error}
          onRetry={() => void accounts.reload()}
          skeleton={{ rows: 4, columns: 7 }}
          empty={query.trim() || layerFilter ? t.noMatches : undefined}
        />
        {active && op ? (
          <Dialog
            open
            size={op.kind === 'fund' || op.kind === 'ceiling' || op.kind === 'password' ? 'form' : 'confirm'}
            title={op.kind === 'fund' ? t.fund : op.kind === 'ceiling' ? t.ceiling : op.kind === 'password' ? t.newPassword : op.kind === 'enter' ? t.enterAccount : op.kind === 'delete' ? t.deleteAccount : active.frozen ? t.restoreAccount : t.freezeAccount}
            lede={op.kind === 'fund' ? t.fundHint : op.kind === 'ceiling' ? t.ceilingHint : op.kind === 'password' ? t.passwordHint : op.kind === 'enter' ? t.enterHint : op.kind === 'delete' ? t.deleteHint : active.frozen ? t.restoreHint : t.freezeHint}
            mark={op.kind === 'fund' || op.kind === 'ceiling' ? 'wallet' : op.kind === 'password' ? 'key' : op.kind === 'enter' ? 'enter' : op.kind === 'delete' ? 'trash' : 'freeze'}
            tone={op.kind === 'delete' || (op.kind === 'freeze' && !active.frozen) ? 'danger' : 'neutral'}
            closeLabel={t.closeMenu}
            error={failure}
            onClose={() => { if (!busy) setOp(null); }}
            footer={(
              <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setOp(null)}>{t.cancel}</Button>
                {op.kind === 'fund' ? <Button type="button" disabled={busy} onClick={() => fund(active)}>{t.fund}</Button> : null}
                {op.kind === 'ceiling' ? <Button type="button" disabled={busy} onClick={() => saveCeiling(active)}>{t.save}</Button> : null}
                {op.kind === 'password' ? <Button type="button" disabled={busy} onClick={() => run(() => api.setUserPassword(active.loginName, passwords[active.loginName] ?? ''))}>{t.save}</Button> : null}
                {op.kind === 'freeze' ? <Button type="button" disabled={busy} onClick={() => run(() => (active.frozen ? api.restoreUser(active.loginName) : api.freezeUser(active.loginName)))}>{active.frozen ? t.restoreAccount : t.freezeAccount}</Button> : null}
                {op.kind === 'enter' ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => send(() => api.enterUser(active.loginName), { then: () => window.location.assign('/numbers'), reload: false })}
                  >
                    {t.enterAccount}
                  </Button>
                ) : null}
                {op.kind === 'delete' ? <Button type="button" variant="danger" disabled={busy} onClick={() => run(() => api.removeUser(active.loginName))}>{t.deleteAccount}</Button> : null}
              </>
            )}
          >
            <div className="dialog-form">
              <p className="dialog-who"><AccountName login={active.loginName} name={active.nickname} /></p>
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
              {op.kind === 'password' ? (
                <label>
                  {t.newPassword}
                  <input type="password" value={passwords[active.loginName] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [active.loginName]: event.target.value }))} />
                </label>
              ) : null}
            </div>
          </Dialog>
        ) : null}
        <TransferDialog
          open={moveRow !== null}
          row={moveRow}
          destinations={destinations}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); void accounts.reload(); }}
        />
      </section>
    </Desk>
  );
}
