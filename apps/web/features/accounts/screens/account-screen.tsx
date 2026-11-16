'use client';

import { ChevronDown, Wallet } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Money, Pane, layerName } from '../../../components/desk';
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
import { useDesk } from '../../../lib/desk-session';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { UserOpsTab } from './line-ops';
import { UserPackagesTab } from './packages-terms';
import { onOffTone } from '../../../lib/status-tone';
import { Badge } from '../../../components/ui/badge';
import { Select, SelectItem } from '../../../components/ui/select';
import { Label } from '../../../components/ui/label';
import { Segmented, SegmentedItem } from '../../../components/ui/segmented';
import { cn } from '../../../lib/cn';
import { LayerTag } from '../layer-tag';
import type { LayerKey } from '../../../lib/api-types';
import { UserSettingsPane } from '../user-settings';
import { RowMenu } from '../../../components/row-menu';
import { Stat, StatRow } from '../../../components/stat';
import { accountTone } from '../../../lib/status-tone';
import { useAccountActions } from '../account-actions';
import { useCrumbs } from '../../../lib/crumbs';
import { Tabs } from '../../../components/tabs';

const ACCOUNT_LAYERS = ['branch', 'main_agent', 'agent', 'staff'];

type Choice = 'role' | 'allow' | 'deny';
// Two tabs since spec 2026-11-08-overview-and-reports-nav, H: «الحساب» (permissions, number operations and the
// account's numbers, each a closed section) and «الرزم والأسعار». An old `#ops` link opens «الحساب».
// Graphite (as in the approved design): every part of the account is its own tab — packages and prices first, then
// the number operations, the account's numbers, and its access. An old `#ops` link opens the operations.
type Tab = 'packages' | 'ops' | 'numbers' | 'access';
const TABS: readonly Tab[] = ['packages', 'ops', 'numbers', 'access'];

/*
 * The user page's own parts (Tailwind migration T4.2, ADR 0022), ported from desk/frame.css, desk/pane.css,
 * desk/users.css and graphite.css in their cascade order:
 * - the title: one wrapping row 12px apart — a 48px crimson mark (6px corners, a 20px bold `--rd-on-accent` letter on
 *   `--rd-accent-fill`, an 11px cut at the top inline end), the name, the layer tag and the state;
 * - the head's actions: one wrapping row 8px apart;
 * - the page column (legacy `.desk > .stack`): a column 12px apart at its own height that never widens the canvas, its
 *   children never wider than it. It keeps the `stack` class as a handle only: the desk column (`has-[>.stack]`,
 *   components/desk.tsx), the canvas (`:has(.stack)`, frame.css) and Pane (`[.desk>.stack>&]`) size to their content
 *   by it;
 * - the access tab's body: a column 12px apart, 14px / 18px / 18px padding, scrolling inside its pane;
 * - the permissions fold: a 1px `--rd-line` box on `--rd-surface` with 6px corners; its summary a wrapping row
 *   (6px / 12px apart, 12px / 14px padding) of the name (13px ink bold) and the count (12px `--rd-muted`), with an 8px
 *   chevron drawn by two 2px `--rd-muted` edges at the end, turned over while open; its body a column 12px apart, 14px
 *   at the sides and the bottom;
 * - the grants: two columns 28px apart (one up to 1100px wide), each grant a row at least 52px high over a 1px
 *   `--rd-line` rule: its name (14px ink bold), its state and the three-way choice, 10px apart (on a phone the choice
 *   takes its own line, full width, and the row 8px of padding above and below); the choice's segments each at least
 *   4.6rem, 8px at the sides, on one line;
 * - the extra roles: a column 8px apart, 8px under the grants, its title 13px bold; the role pick at most 24rem wide at
 *   the reading start; the role chips one wrapping row 8px apart, each 34px high (40px on a phone, at least 44px up to
 *   720px), 14px at the sides, 6px corners, a 1px ink-at-11% border, 12px `--rd-muted` 600 on `--rd-surface-2`;
 *   chosen, `--rd-accent` on `--rd-accent-soft` with a crimson border at 55%; a 2px crimson focus outline 2px out;
 * - the save: at the reading start over a 1px `--rd-line` rule, 4px and 12px above it.
 */
const HERO_MARK = cn(
  'grid size-12 flex-none place-items-center rounded-sm bg-accent-fill text-3xl font-bold text-on-accent',
  '[clip-path:polygon(0_0,calc(100%_-_11px)_0,100%_11px,100%_100%,0_100%)] rtl:[clip-path:polygon(11px_0,100%_0,100%_100%,0_100%,0_11px)]',
);
const COLUMN = 'stack flex min-h-auto min-w-0 max-w-full flex-none flex-col gap-3 overflow-visible *:min-w-0';
const FOLD_SUMMARY = cn(
  'flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1.5 px-3.5 py-3 [&::-webkit-details-marker]:hidden',
  "after:ms-auto after:size-2 after:self-center after:rotate-45 after:border-e-2 after:border-b-2 after:border-muted after:content-['']",
  'group-open:after:rotate-[225deg]',
);
const ROLE_CHIP = cn(
  'h-8.5 cursor-pointer rounded-sm border border-line-strong bg-surface-2 px-3.5 text-sm font-semibold text-muted max-sm:h-10 max-touch:min-h-11',
  'aria-pressed:border-accent/55 aria-pressed:bg-accent-soft aria-pressed:text-accent',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
);
const SAVE_ROW = 'mt-1 flex justify-start border-t border-line pt-3';

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
  const allowed = useRequireLayer(ACCOUNT_LAYERS);
  const { me } = useDesk();
  const [tab, setTab] = useHashTab();
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);
  const [extraRoleIds, setExtraRoleIds] = useState<string[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const account = useApiQuery(sharedKeys.account(params.login), () => api.account(params.login), { enabled: allowed });
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
    <span className="inline-flex flex-wrap items-center gap-3">
      <span className={HERO_MARK} aria-hidden="true">{(row.nickname.trim() || row.loginName).charAt(0)}</span>
      <AccountName login={row.loginName} name={row.nickname} />
      <LayerTag layer={row.layer} />
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
    <div className="inline-flex flex-wrap items-center gap-2">
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
  // «إعدادات الحساب» is the branch owner's, for any account (spec 2026-11-11-ui-consistency-pass, D3).
  const ownerSettings = Boolean(me?.layer === 'branch' && me.isBranchOwner && !me.impersonating);
  const allowedCount = row ? GRANT_CODES.filter((code) => {
    const mode = (picked[code] ?? 'role') as Choice;
    return row.isBranchOwner || (mode === 'deny' ? false : mode === 'allow' ? true : roleHas.has(code));
  }).length : 0;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    ...(withTerms ? [{ key: 'packages' as const, label: t.packagesPricesTab, count: counts.packages || undefined }] : []),
    ...(withTerms ? [{ key: 'ops' as const, label: t.lineOpsTab, count: counts.ops || undefined }] : []),
    ...(row && !row.staff && row.layer !== 'branch' ? [{ key: 'numbers' as const, label: t.accountNumbers }] : []),
    { key: 'access', label: ownerSettings ? t.settingsAccessTab : t.accountAccess },
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
        <Pane>
          <TableSkeleton rows={4} columns={3} />
        </Pane>
      ) : row && (
        <div className={COLUMN}>
          {listed ? <MoneyCards row={listed} /> : null}
          <Tabs items={tabs} value={openTab} onChange={setTab} />
          {openTab === 'access' && (
          // Settings open on top, permissions folded under them (spec 2026-11-11-ui-consistency-pass, D3).
          <Pane>
            <div className="grid min-h-0 content-start gap-3 overflow-auto px-4.5 pt-3.5 pb-4.5 *:min-w-0">
              {ownerSettings ? <UserSettingsPane loginName={row.loginName} layer={row.layer as LayerKey} onSaved={(text) => { setError(''); setNote(text); }} /> : null}
              <details className="group rounded-sm border border-line bg-surface" data-testid="access-fold">
                <summary className={FOLD_SUMMARY}>
                  <b className="text-md text-ink">{t.accountAccess}</b>
                  <span className="text-sm text-muted">{t.grantsSummary.replace('{n}', String(allowedCount)).replace('{total}', String(GRANT_CODES.length))}</span>
                </summary>
                <div className="grid gap-3 px-3.5 pb-3.5">
                  <ul className="m-0 grid list-none grid-cols-2 gap-x-7 p-0 max-xl:grid-cols-1">
                    {GRANT_CODES.map((code) => {
                      const fromRole = row.isBranchOwner || roleHas.has(code);
                      const mode = (picked[code] ?? 'role') as Choice;
                      const on = row.isBranchOwner || (mode === 'deny' ? false : mode === 'allow' ? true : fromRole);
                      const name = grantLabel(t, code, row.layer);
                      return (
                        <li
                          key={code}
                          className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line max-sm:grid-cols-title-end max-sm:py-2"
                        >
                          <span className="text-base font-bold text-ink">{name}</span>
                          <Badge variant={onOffTone(on)} dot>{on ? t.grantAllow : t.grantDeny}</Badge>
                          {row.canEdit ? (
                            // The same three-way switch as the run modes (Segmented): the role decides, or allow, or deny.
                            <Segmented
                              className="inline-grid auto-cols-[minmax(4.6rem,1fr)] grid-flow-col max-sm:col-span-full max-sm:w-full"
                              aria-label={name}
                              value={mode}
                              disabled={busy}
                              onValueChange={(choice) => setChoices({ ...picked, [code]: choice as Choice })}
                            >
                              {(['role', 'allow', 'deny'] as const).map((choice) => (
                                <SegmentedItem key={choice} value={choice} className="px-2 whitespace-nowrap">
                                  {choice === 'role' ? t.followRole : choice === 'allow' ? t.grantAllow : t.grantDeny}
                                </SegmentedItem>
                              ))}
                            </Segmented>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {showExtras && (
                    <div className="grid gap-2 pt-2">
                      <h3 className="m-0 text-md font-bold">{t.extraRoles}</h3>
                      {row.staff && (
                        <Label tone="pane" className="max-w-96 justify-items-start">
                          {t.role}
                          <Select place="pane" value={primary} onValueChange={setRoleId}>
                            {row.roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
                          </Select>
                        </Label>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {jobRoles.map((role) => {
                          const held = extras.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              className={ROLE_CHIP}
                              aria-pressed={held}
                              disabled={busy}
                              onClick={() => setExtraRoleIds(held ? extras.filter((id) => id !== role.id) : [...extras, role.id])}
                            >
                              {role.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {row.canEdit && (
                    <div className={SAVE_ROW}>
                      <Button type="button" disabled={busy} onClick={save}>{t.save}</Button>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </Pane>
          )}
          {openTab === 'ops' && withTerms ? (
            <Pane>
              <UserOpsTab login={row.loginName} canEdit={canEditTerms} setError={setError} setNote={setNote} />
            </Pane>
          ) : null}
          {openTab === 'numbers' ? (
            <Pane>
              <AccountLines login={row.loginName} />
            </Pane>
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
    pick(await api.lines({ loginName: login, cursor }), pageRows),
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
