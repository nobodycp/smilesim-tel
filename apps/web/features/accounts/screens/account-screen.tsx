'use client';

import { ChevronDown, Wallet } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, layerName } from '../../../components/desk';
import { lineStatus } from '../../../components/names';
import { TableSkeleton } from '../../../components/loading';
import { Button, buttonClass } from '../../../components/ui/button';
import { PagedTable, type Column } from '../../../components/data-table';
import { latinWhen } from '../../../components/desk';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { lineTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api, type LineRow, type UserRow } from '../../../lib/api';
import { GRANT_CODES, grantLabel } from '../../../lib/grants';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useOffice } from '../../../lib/office-session';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { UserOpsTab } from './line-ops';
import { UserPackagesTab } from './packages-terms';
import { onOffTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';
import { Select } from '../../../components/ui/select';
import { RowMenu } from '../../../components/row-menu';
import { Stat, StatRow } from '../../../components/stat';
import { accountTone } from '../../../lib/status-tone';
import { useAccountActions } from '../account-actions';
import { useCrumbs } from '../../../lib/crumbs';
import { Tabs } from '../../../components/tabs';

const OFFICE_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

type Choice = 'role' | 'allow' | 'deny';
// Two tabs since spec 2026-11-08-overview-and-reports-nav, H: «الحساب» (permissions, number operations and the
// account's numbers, each a closed section) and «الرزم والأسعار». An old `#ops` link opens «الحساب».
// Graphite (as in the approved design): every part of the account is its own tab — packages and prices first, then
// the number operations, the account's numbers, and its access. An old `#ops` link opens the operations.
type Tab = 'packages' | 'ops' | 'numbers' | 'access';
const TABS: readonly Tab[] = ['packages', 'ops', 'numbers', 'access'];

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The open tab lives in the URL hash so a link can open it. */
function useHashTab(): [Tab, (next: Tab) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const tab = TABS.find((item) => `#${item}` === hash) ?? ('' as Tab);
  return [tab, (next) => {
    window.history.replaceState(null, '', `#${next}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }];
}

export function AccountScreen() {
  const { t } = usePrefs();
  const params = useParams<{ login: string }>();
  const allowed = useRequireLayer(OFFICE_LAYERS);
  const { me } = useOffice();
  const [tab, setTab] = useHashTab();
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [extraRoleIds, setExtraRoleIds] = useState<string[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const account = useApiQuery(sharedKeys.account(params.login), () => api.officeAccount(params.login), { enabled: allowed });
  const row = account.data;
  useCrumbs({ [`/users/${encodeURIComponent(params.login)}`]: row ? `${row.loginName} (${row.nickname})` : null });
  const picked = choices ?? Object.fromEntries(GRANT_CODES.map((code) => {
    if (row?.deniedGrants.includes(code)) return [code, 'deny'];
    if (row?.extraGrants.includes(code)) return [code, 'allow'];
    return [code, 'role'];
  }));
  const extras = extraRoleIds ?? row?.extraRoleIds ?? [];
  const primary = roleId ?? row?.roleId ?? '';
  const { run, busy } = useAction({ setError, setNote, onDone: account.reload });
  const router = useRouter();
  const accountActions = useAccountActions({
    error,
    setError,
    setNote,
    onDone: account.reload,
    onDeleted: () => router.push('/users'),
  });
  // The server is the judge; this only hides controls from accounts that can never pass it.
  const canEditTerms = Boolean(
    row && !row.staff && row.layer !== 'branch' && me && !me.impersonating && (me.layer === 'branch' ? me.isBranchOwner || me.grants.includes('edit') : me.loginName === row.parentLoginName),
  );
  // Tab counts: packages with a custom price, operations stopped. The tabs read the same cached answers.
  const termsFor = row?.loginName ?? params.login;
  const packagesRead = useApiQuery(sharedKeys.accountPackages(termsFor), () => api.userPackages(termsFor), { enabled: canEditTerms });
  const opsRead = useApiQuery(sharedKeys.accountOps(termsFor), () => api.userOps(termsFor), { enabled: canEditTerms });
  const counts = {
    packages: packagesRead.data?.summary.custom ?? 0,
    ops: (opsRead.data?.denied.length ?? 0) + (opsRead.data?.deniedAbove.length ?? 0),
  };

  // A new answer for the account drops the unsaved picks, so the form shows what the server holds. Done while
  // rendering, when the answer changes, instead of in an effect.
  const [pickedFor, setPickedFor] = useState(account.data);
  if (account.data !== pickedFor) {
    setPickedFor(account.data);
    setChoices(null);
    setExtraRoleIds(null);
    setRoleId(null);
  }

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
  const listed = row?.listed ?? null;
  const title = row ? (
    // Graphite: the account's cut-corner mark, the name, its layer as a tag, then its state.
    <span className="account-title">
      <span className="account-hero-mark" aria-hidden="true">{(row.nickname.trim() || row.loginName).charAt(0)}</span>
      <AccountName login={row.loginName} name={row.nickname} />
      <span className={`layer-tag l-${row.layer}`}>{layerName(t, row.layer)}</span>
      <Badge variant={accountTone(row.frozen)} dot>{row.frozen ? t.frozen : t.accountOpen}</Badge>
    </span>
  ) : t.accountName;
  const lede = row
    ? [layerName(t, row.layer), row.parentLoginName ? `${t.parent}: ${row.parentLoginName}` : '', row.staff ? row.roleName : ''].filter(Boolean).join(' · ')
    : '';
  // The head groups the wallet's actions under «المحفظة» (fund, deduct, ceiling, statement); every other action of
  // the users list waits behind ⋯.
  const { wallet: walletItems, more } = listed ? accountActions.groupedFor(listed) : { wallet: [], more: [] };
  const actions = [...walletItems, ...more];
  const head = actions.length > 0 || walletItems.length > 0 ? (
    <div className="page-actions">
      {walletItems.length > 0 ? (
        <RowMenu
          boxed
          label={t.walletActions}
          items={walletItems}
          trigger={{ className: buttonClass({ variant: 'secondary' }), content: <><Wallet size={16} aria-hidden="true" />{t.walletActions}<ChevronDown size={14} aria-hidden="true" /></> }}
        />
      ) : null}
      {more.length > 0 ? <RowMenu boxed label={t.moreActions} items={more} /> : null}
    </div>
  ) : null;
  const jobRoles = (row?.roles ?? []).filter((role) => role.id !== primary);
  const showExtras = Boolean(row?.canEdit && (row.staff || jobRoles.length > 0));
  // The API refuses to read the terms of an account the actor may not edit, so the two tabs
  // exist only for the direct parent and the branch; a hash to a hidden tab falls back to access.
  const withTerms = Boolean(canEditTerms && row && !row.staff);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    ...(withTerms ? [{ key: 'packages' as const, label: t.packagesPricesTab, count: counts.packages || undefined }] : []),
    ...(withTerms ? [{ key: 'ops' as const, label: t.lineOpsTab, count: counts.ops || undefined }] : []),
    ...(row && !row.staff && row.layer !== 'branch' ? [{ key: 'numbers' as const, label: t.accountNumbers }] : []),
    { key: 'access', label: t.accountAccess },
  ];
  const openTab: Tab = tabs.some((item) => item.key === tab) ? tab : tabs[0].key;

  return (
    <Desk
      title={title}
      lede={lede}
      action={head}
      error={error || account.error}
      note={note}
    >
      {!account.loaded ? (
        <section className="pane">
          <TableSkeleton rows={4} columns={3} />
        </section>
      ) : row && (
        <div className="stack flow">
          {listed ? <MoneyCards row={listed} /> : null}
          <Tabs items={tabs} value={openTab} onChange={setTab} />
          {openTab === 'access' && (
          <section className="pane">
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
                    <span>{grantLabel(t, code, row.layer)}</span>
                    <Badge variant={onOffTone(on)} dot>{on ? t.grantAllow : t.grantDeny}</Badge>
                    {row.canEdit ? (
                      <Select
                        aria-label={grantLabel(t, code, row.layer)}
                        value={mode}
                        onChange={(event) => setChoices({ ...picked, [code]: event.target.value as Choice })}
                      >
                        <option value="role">{t.followRole}</option>
                        <option value="allow">{t.grantAllow}</option>
                        <option value="deny">{t.grantDeny}</option>
                      </Select>
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
                      <Select value={primary} onChange={(event) => setRoleId(event.target.value)}>
                        {row.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </Select>
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
          )}
          {openTab === 'ops' && withTerms ? (
            <section className="pane">
              <UserOpsTab login={row.loginName} canEdit={canEditTerms} setError={setError} setNote={setNote} />
            </section>
          ) : null}
          {openTab === 'numbers' ? (
            <section className="pane">
              <AccountLines login={row.loginName} />
            </section>
          ) : null}
          {openTab === 'packages' && !row.staff && <UserPackagesTab login={row.loginName} canEdit={canEditTerms} setError={setError} setNote={setNote} />}
        </div>
      )}
      {accountActions.dialogs}
    </Desk>
  );
}

/** The account's wallet as four cards: balance, ceiling (with the share used), used from the ceiling, available. */
function MoneyCards({ row }: { row: UserRow }) {
  const { t } = usePrefs();
  const unlimited = row.layer === 'branch';
  const used = Math.max(0, -row.balance);
  // What the account may still spend: what is held for open tasks is not (roadmap N6).
  const available = row.balance + row.ceiling - (row.held ?? 0);
  return (
    <StatRow>
      <Stat icon="wallet" label={t.balance} value={<Money value={row.balance} />} />
      <Stat
        icon="lock"
        label={t.ceiling}
        value={unlimited ? t.noCeiling : <Money value={row.ceiling} />}
        progress={unlimited || row.ceiling <= 0 ? null : used / row.ceiling}
      />
      <Stat icon="reports" label={t.usedCeiling} value={unlimited ? '—' : <Money value={used} />} />
      <Stat icon="tasks" tone={row.held ? 'warning' : 'muted'} label={t.held} value={<Money value={row.held ?? 0} />} meta={t.heldHint} />
      <Stat icon="plans" label={t.availableToSell} value={unlimited ? t.noCeiling : <Money value={available} />} highlight />
    </StatRow>
  );
}

/** The account's numbers: its own if it is a point of sale, else every point of sale's below it. */
function AccountLines({ login }: { login: string }) {
  const { t } = usePrefs();
  const list = usePaged<LineRow>(`account:${login}`, async (cursor) =>
    pick(await api.officeLines({ loginName: login, cursor }), pageRows),
  );
  const columns: Column<LineRow>[] = [
    { key: 'number', header: t.number, render: (line) => <a href={`/numbers/${encodeURIComponent(line.id)}`}><bdi dir="ltr">{line.msisdn}</bdi></a> },
    { key: 'package', header: t.packageName, render: (line) => line.packageName || '—' },
    { key: 'pos', header: t.pointOfSale, render: (line) => (line.posLoginName ? <AccountName login={line.posLoginName} /> : '—') },
    { key: 'status', header: t.status, render: (line) => <Badge variant={lineTone(line.suspended ? 'suspended' : line.status)} dot>{lineStatus(t, line.suspended ? 'suspended' : line.status)}</Badge> },
    { key: 'ends', header: t.endsOn, render: (line) => (line.endsAt ? <bdi dir="ltr">{latinWhen(line.endsAt)}</bdi> : '—') },
  ];
  return <PagedTable list={list} columns={columns} rowKey={(line) => line.id} empty={t.noLines} skeleton={{ rows: 4, columns: 5 }} />;
}
