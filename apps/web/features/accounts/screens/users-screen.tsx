'use client';

import { Plus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { NameField } from '../../../components/name-field';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type UserRow } from '../../../lib/api';
import { everyAccount } from '../../../lib/directory';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { accountTone } from '../../../lib/status-tone';
import { useAccountActions } from '../account-actions';

const layerOrder = ['branch', 'main_agent', 'agent', 'pos'];
// Everyone but a point of sale; a staff account opens the desk through the branch door.
const OFFICE_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

const FILTER_KEYS = ['q', 'layer'] as const;

export function UsersScreen() {
  const { t } = usePrefs();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ loginName: '', nickname: '', password: '', layer: '', parentLoginName: '', roleId: '' });
  // The filters live in the address (`?q=…&layer=pos`): the shell search can open this page filtered, even from it.
  // The server filters and pages (4.4c): what is typed reaches the address, and the list, after a pause.
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const layerFilter = filters.layer;
  const commitQuery = useCallback((value: string) => setFilters({ q: value }), [setFilters]);
  const [query, setQuery] = useDebouncedField(filters.q, commitQuery);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { me } = useOffice();
  const allowed = useRequireLayer(OFFICE_LAYERS);
  const needle = filters.q.trim();
  const list = usePaged<UserRow>(
    `${needle}|${layerFilter}`,
    async (cursor) => pick(await api.officeUsersPage({ q: needle, layer: layerFilter, cursor }), pageRows),
    { enabled: allowed },
  );
  // The whole visible tree, read only while "new account" needs it for the parent choice. The shell search, the line
  // card and a move's destinations share this entry.
  const accounts = useApiQuery(sharedKeys.users, everyAccount, { enabled: allowed && creating });
  const everyone = accounts.data?.users ?? [];
  const roles = useApiQuery(sharedKeys.roles, () => api.officeRoles(), { enabled: draft.layer === 'staff' }).data?.roles ?? [];
  const reloadAll = useCallback(async () => {
    await Promise.all([list.reload(), accounts.reload()]);
  }, [list, accounts]);
  const { run: send, busy } = useAction({ setError, setNote, onDone: reloadAll });
  const failure = error;
  const accountActions = useAccountActions({ error, setError, setNote, onDone: reloadAll });
  const creatable = me?.layer === 'branch'
    ? ['main_agent', 'agent', 'pos', ...(me.isBranchOwner || me.grants?.includes('staff') ? ['staff'] : [])]
    : me?.layer === 'main_agent'
      ? ['agent', 'pos']
      : me?.layer === 'agent'
        ? ['pos']
        : [];
  const directLayer = me?.layer === 'branch' ? 'main_agent' : me?.layer === 'main_agent' ? 'agent' : 'pos';

  async function createAccount() {
    await send(
      () => api.createUser({
        loginName: draft.loginName.trim(),
        nickname: draft.nickname.trim(),
        password: draft.password,
        layer: draft.layer || creatable[0],
        parentLoginName: draft.parentLoginName || undefined,
        roleId: draft.roleId || undefined,
      }),
      {
        note: t.openAccount,
        then: () => {
          setCreating(false);
          setDraft({ loginName: '', nickname: '', password: '', layer: '', parentLoginName: '', roleId: '' });
        },
      },
    );
  }


  const columns: Column<UserRow>[] = [
    {
      key: 'account',
      header: t.accountName,
      render: (row) => (
        // Graphite: the name over the login, beside a square mark.
        <Link className="row-link account-cell" href={`/users/${row.loginName}`} aria-label={accountLabel(row.loginName, row.nickname)}>
          <span className="account-mark" aria-hidden="true">{(row.nickname.trim() || row.loginName).charAt(0)}</span>
          <span className="account-id">
            <strong><bdi>{row.nickname.trim() || row.loginName}</bdi></strong>
            {row.nickname.trim() && row.nickname.trim() !== row.loginName ? <span className="sub" dir="ltr">{row.loginName}</span> : null}
          </span>
        </Link>
      ),
    },
    { key: 'layer', header: t.layer, fit: true, render: (row) => <span className={`layer-tag l-${row.layer}`}>{layerName(t, row.layer)}</span> },
    { key: 'parent', header: t.parent, fit: true, render: (row) => <AccountName login={row.parentLoginName} /> },
    { key: 'balance', header: t.balance, num: true, render: (row) => <Money value={row.balance} /> },
    { key: 'ceiling', header: t.ceiling, num: true, render: (row) => (row.layer === 'branch' ? '—' : <Money value={row.ceiling} />) },
    {
      key: 'status',
      header: t.status,
      fit: true,
      render: (row) => (
        <Badge variant={accountTone(row.frozen)} dot>
          {row.frozen ? t.frozen : t.accountOpen}
        </Badge>
      ),
    },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => {
        // «المحفظة» (fund, deduct, ceiling, statement) beside ⋯ for the rest, as on the user page.
        const { wallet, more } = accountActions.groupedFor(row);
        const who = accountLabel(row.loginName, row.nickname);
        return (
          <span className="row-menus">
            <RowMenu label={`${t.walletActions} ${who}`} items={wallet} trigger={{ className: 'row-menu-btn', content: <Wallet size={16} aria-hidden="true" />, iconOnly: true }} />
            <RowMenu label={`${t.rowActions} ${who}`} items={more} />
          </span>
        );
      },
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
      <FilterBar onClear={() => setFilters({ q: '', layer: '' })} clearLabel={t.clearFilters}>
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
          <h2>{t.usersList}{list.ready ? <span className="count">{list.total ?? list.all.length}</span> : null}</h2>
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
              <Select value={draft.layer || creatable[0]} onChange={(event) => setDraft((current) => ({ ...current, layer: event.target.value, parentLoginName: '' }))}>
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
                <NameField
                  value={draft.parentLoginName}
                  onChange={(next) => setDraft((current) => ({ ...current, parentLoginName: next }))}
                  options={everyone.filter((row) => row.layer === ((draft.layer || creatable[0]) === 'agent' ? 'main_agent' : 'agent')).map((row) => ({
                    value: row.loginName, label: accountLabel(row.loginName, row.nickname), keys: [row.loginName],
                  }))}
                />
              </label>
            )}
          </div>
        </Dialog>
        <PagedTable
          list={list}
          columns={columns}
          rowKey={(row) => row.loginName}
          skeleton={{ rows: 4, columns: 7 }}
          empty={needle || layerFilter ? t.noMatches : undefined}
        />
        {accountActions.dialogs}
      </section>
    </Desk>
  );
}
