'use client';

import { Plus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AccountName, accountLabel } from '../../../components/account-name';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Money, Pane, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectItem } from '../../../components/ui/select';
import { NameField } from '../../../components/name-field';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type UserRow } from '../../../lib/api';
import { everyAccount } from '../../../lib/directory';
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { accountTone } from '../../../lib/status-tone';
import { useAccountActions } from '../account-actions';
import { LayerTag } from '../layer-tag';

const layerOrder = ['branch', 'main_agent', 'agent', 'pos'];
// Everyone but a point of sale; a staff account opens the desk through the branch door.
const ACCOUNT_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

const FILTER_KEYS = ['q', 'layer'] as const;

/*
 * The users list's own parts (Tailwind migration T4.2, ADR 0022), ported from desk/pane.css, desk/table.css, dialog.css
 * and graphite.css in their cascade order:
 * - the list card's head: a row at least 52px high, 14px / 18px padding, its parts at both ends 8px apart, a 1px
 *   `--rd-line` rule under it; its title 14px ink bold with the count beside it, 8px apart; the count a 20px-wide pill
 *   of 6px sides on 4px corners, 11px `--rd-accent` 600 tabular on `--rd-accent-soft`;
 * - an account cell: a link in the text colour at 500, its parts 10px apart (the name over the login beside a 32px
 *   square mark: 6px corners, a 13px bold `--rd-accent` letter on `--rd-surface-2` with a 1px inset `--rd-line` edge);
 *   the name bold, the login under it 11.5px `--rd-muted` at 400 and 1.3 line height;
 * - the two row menus side by side, 4px apart;
 * - the new account form: a column 12px apart.
 */
const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
const COUNT = 'inline-flex min-w-5 items-center rounded-xs bg-accent-soft px-1.5 text-xs font-semibold text-accent tabular-nums';

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
  const { me } = useDesk();
  const allowed = useRequireLayer(ACCOUNT_LAYERS);
  const needle = filters.q.trim();
  const list = usePaged<UserRow>(
    `${needle}|${layerFilter}`,
    async (cursor) => pick(await api.usersPage({ q: needle, layer: layerFilter, cursor }), pageRows),
    { enabled: allowed },
  );
  // The whole visible tree, read only while "new account" needs it for the parent choice. The shell search, the line
  // card and a move's destinations share this entry.
  const accounts = useApiQuery(sharedKeys.users, everyAccount, { enabled: allowed && creating });
  const everyone = accounts.data?.users ?? [];
  const roles = useApiQuery(sharedKeys.roles, () => api.roles(), { enabled: draft.layer === 'staff' }).data?.roles ?? [];
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
        <Link className="flex min-w-0 items-center gap-2.5 font-medium text-inherit no-underline" href={`/users/${row.loginName}`} aria-label={accountLabel(row.loginName, row.nickname)}>
          <span className="inline-flex size-8 flex-none items-center justify-center rounded-sm bg-surface-2 text-md font-bold text-accent inset-ring inset-ring-line" aria-hidden="true">
            {(row.nickname.trim() || row.loginName).charAt(0)}
          </span>
          <span className="flex min-w-0 flex-col text-start">
            <strong className="font-bold"><bdi>{row.nickname.trim() || row.loginName}</bdi></strong>
            {row.nickname.trim() && row.nickname.trim() !== row.loginName ? (
              <span className="block text-[11.5px] leading-[1.3] font-normal text-muted" dir="ltr">{row.loginName}</span>
            ) : null}
          </span>
        </Link>
      ),
    },
    { key: 'layer', header: t.layer, fit: true, render: (row) => <LayerTag layer={row.layer} /> },
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
          <span className="inline-flex items-center gap-1">
            <RowMenu label={`${t.walletActions} ${who}`} items={wallet} trigger={{ content: <Wallet size={16} aria-hidden="true" />, iconOnly: true }} />
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
          <Select value={layerFilter} onValueChange={(next) => setFilters({ layer: next })}>
            <SelectItem value="">{t.allRows}</SelectItem>
            {layerOrder.map((value) => (
              <SelectItem key={value} value={value}>{layerName(t, value)}</SelectItem>
            ))}
          </Select>
        </label>
      </FilterBar>
      <Pane>
        <header className={PANE_HEAD}>
          <h2 className={PANE_TITLE}>{t.usersList}{list.ready ? <span className={COUNT} data-testid="list-count">{list.total ?? list.all.length}</span> : null}</h2>
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
          <div className="grid gap-3">
            <Label tone="dialog">
              {t.loginName}
              <Input value={draft.loginName} dir="ltr" onChange={(event) => setDraft((current) => ({ ...current, loginName: event.target.value }))} />
            </Label>
            <Label tone="dialog">
              {t.fullName}
              <Input value={draft.nickname} autoComplete="off" onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))} />
            </Label>
            <Label tone="dialog">
              {t.newPassword}
              <Input type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            </Label>
            <Label tone="dialog">
              {t.layer}
              <Select place="dialog" value={draft.layer || creatable[0]} onValueChange={(next) => setDraft((current) => ({ ...current, layer: next, parentLoginName: '' }))}>
                {creatable.map((value) => (
                  <SelectItem key={value} value={value}>{layerName(t, value)}</SelectItem>
                ))}
              </Select>
            </Label>
            {(draft.layer || creatable[0]) === 'staff' && (
              <Label tone="dialog">
                {t.role}
                <Select place="dialog" value={draft.roleId} onValueChange={(next) => setDraft((current) => ({ ...current, roleId: next }))}>
                  <SelectItem value="">—</SelectItem>
                  {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
                </Select>
              </Label>
            )}
            {(draft.layer || creatable[0]) !== directLayer && (draft.layer || creatable[0]) !== 'staff' && (
              <Label tone="dialog">
                {t.parent}
                <NameField
                  value={draft.parentLoginName}
                  onChange={(next) => setDraft((current) => ({ ...current, parentLoginName: next }))}
                  options={everyone.filter((row) => row.layer === ((draft.layer || creatable[0]) === 'agent' ? 'main_agent' : 'agent')).map((row) => ({
                    value: row.loginName, label: accountLabel(row.loginName, row.nickname), keys: [row.loginName],
                  }))}
                />
              </Label>
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
      </Pane>
    </Desk>
  );
}
