'use client';

import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Check, Plus } from 'lucide-react';
import { Desk, Pane, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { api, type RoleRow } from '../../../lib/api';
import type { LayerKey, SessionRuleValues, TwoFactorMethod } from '../../../lib/api-types';
import { RuleSelects, sessionRulesValid } from '../../auth/session-rules';
import { LayerTwoFactor, savableMethod } from '../../auth/two-factor-policy';
import { LiveSwitch } from '../../../components/live-switch';
import { cn } from '../../../lib/cn';
import { GRANT_CODES, grantGroupsFor, grantLabel, grantUsable, type GrantGroupKey } from '../../../lib/grants';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';

type RoleDraft = { id: string; name: string; kind: 'layer' | 'job'; layer: string; grants: string[] };

const FLAG_KEYS = ['read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter'] as const;

function codesOf(row: RoleRow) {
  if (row.grants && row.grants.length > 0) return [...row.grants];
  return FLAG_KEYS.filter((key) => row[key]);
}

const emptyDraft = (): RoleDraft => ({ id: '', name: '', kind: 'job', layer: '', grants: ['read'] });

// A job role has no layer of its own: it belongs to the branch, so it is worded and offered as the branch's.
const layerOf = (role: { layer?: string }) => role.layer || 'branch';

/*
 * The matrix and the role form (Tailwind migration T4.10), ported from graphite.css's roles rules and dialog.css in
 * their cascade order:
 * - a role's kind under its name: a block 11.5px muted 400 at 1.3 (`[data-slot='table'] .sub`);
 * - a grant tile (`.grant`): a 22px inline grid, its mark centred, 4px corners, an inset 1px `--rd-line-strong` edge, at
 *   the text's middle; held (`.on`): `--rd-success` on `--rd-success-soft` with a `--rd-success` edge. A grant its layer
 *   can never use is a muted dash at 50% (`.grant-none`);
 * - the form (`.dialog-form`): a column 12px apart; the session rules and the two-step block under the grants each 8px
 *   lower with a hairline and 14px above them;
 * - the grants block (`.role-block`): a grid with no gap; its head one row 8px over the groups, the title (14px bold
 *   ink) at the start and the count (12px muted 500, tabular) at the end, on one baseline 12px apart;
 * - a group (`.role-group`): a 148px rail beside its rows, 16px apart, 4px above and under, a hairline over it; the
 *   rail 9px down, its name 12.5px bold ink at 1.3 over its count (12px muted, tabular, 2px under). Under 641px the
 *   rail is one row over the rows (name at the start, count at the end, on one baseline), 12px above and 4px under
 *   the group, the rows 4px under the rail;
 * - a row (`.role-row`): the grant's name and its switch at the two ends, 12px apart, at least 34px high (44px under
 *   641px), the whole row the target, a soft hairline between rows; the name 13px muted 500, ink 700 while on;
 * - the session rules' title as the grants' title, its hint 12px muted at 1.5, 4px over and 12px under it.
 */
const CELL_SUB = 'block text-[11.5px] leading-[1.3] font-normal text-muted';
const BLOCK_TITLE = 'm-0 text-base font-bold text-ink';
const UNDER_GRANTS = 'mt-2 border-t border-line pt-3.5';
/** The two-step block (features/auth/two-factor-policy.tsx) is placed by the form, through its handle. */
const TWO_FACTOR_UNDER_GRANTS =
  '[&>[data-slot=layer-two-factor]]:mt-2 [&>[data-slot=layer-two-factor]]:border-t [&>[data-slot=layer-two-factor]]:border-line [&>[data-slot=layer-two-factor]]:pt-3.5';
const GRANT = 'inline-grid size-5.5 place-items-center rounded-xs align-middle inset-ring inset-ring-line-strong';

const GROUP_TITLE = { view: 'grantGroupView', work: 'grantGroupWork', accounts: 'grantGroupAccounts' } as const satisfies Record<GrantGroupKey, string>;

export function RolesScreen() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const roles = useApiQuery(sharedKeys.roles, () => api.roles());
  const rows = roles.data?.roles ?? [];
  const { run, busy } = useAction({ setError, setNote, onDone: roles.reload });
  const failure = error;

  function edit(row?: RoleRow) {
    setRuleDraft(null);
    setPolicyDraft(null);
    setDraft(row
      ? { id: row.id, name: row.name, kind: row.kind === 'layer' ? 'layer' : 'job', layer: row.layer ?? '', grants: codesOf(row) }
      : emptyDraft());
    setOpen(true);
  }

  // A layer role carries its layer's session defaults (spec 2026-11-09-admin-review, 6.1): open sessions and idle
  // time for every account of the layer that has no value of its own.
  const rules = useApiQuery(['auth', 'session-rules'], () => api.sessionRules(), { enabled: open && draft.kind === 'layer' });
  const [ruleDraft, setRuleDraft] = useState<SessionRuleValues | null>(null);
  // …and its two-step rule: required or optional, with the default method (spec 2026-11-11-two-factor-policy).
  const policy = useApiQuery(['auth', 'two-factor-policy'], () => api.twoFactorPolicy(), { enabled: open && draft.kind === 'layer' });
  const [policyDraft, setPolicyDraft] = useState<{ required: boolean; method: TwoFactorMethod } | null>(null);
  const layerKey = (draft.kind === 'layer' ? draft.layer : '') as LayerKey | '';
  const ruleValues = ruleDraft ?? (layerKey && rules.data ? rules.data.layers[layerKey] : null);
  const groups = grantGroupsFor(layerOf(draft));
  // «حفظ» waits while a session value is outside its range.
  const policyValue = policyDraft ?? (layerKey && policy.data ? policy.data.policy[layerKey] : null);
  const rulesBad = Boolean(layerKey && ruleValues && !sessionRulesValid(ruleValues));

  async function save() {
    const flags = {
      read: draft.grants.includes('read'),
      edit: draft.grants.includes('edit'),
      accounting: draft.grants.includes('accounting'),
      tasks: draft.grants.includes('tasks'),
      reports: draft.grants.includes('reports'),
      staff: draft.grants.includes('staff'),
      enter: draft.grants.includes('enter'),
    };
    await run(async () => {
      const saved = await api.saveRole({ id: draft.id || undefined, name: draft.name, grants: draft.grants, ...flags });
      if (!saved.ok || !layerKey) return saved.ok ? { ok: true as const, data: null } : saved;
      if (ruleDraft) {
        const ruled = await api.setLayerSessionRules(layerKey, ruleDraft);
        if (!ruled.ok) return ruled;
      }
      if (policyDraft && policy.data) {
        const before = policy.data.policy[layerKey];
        // Saved as required, the layer carries a method the screens offer (the API refuses one that is switched off).
        const method = policyDraft.required ? savableMethod(policyDraft.method) : policyDraft.method;
        const ruled = await api.setTwoFactorPolicy(layerKey, {
          ...(policyDraft.required !== before.required ? { required: policyDraft.required } : {}),
          ...(method !== before.method ? { method } : {}),
        });
        if (!ruled.ok) return ruled;
        if (ruled.data.endedAccounts > 0) setNote(t.twoFactorEnded.replace('{count}', String(ruled.data.endedAccounts)));
      }
      return { ok: true as const, data: null };
    }, { then: () => { setOpen(false); setRuleDraft(null); setPolicyDraft(null); void rules.reload(); void policy.reload(); } });
  }

  function roleTitle(row: { kind?: string; layer?: string; name: string }) {
    return row.kind === 'layer' && row.layer ? layerName(t, row.layer) : row.name;
  }

  // The design's matrix: one column per grant, a green tick where the role holds it, an empty box where it does not,
  // a dash where its layer can never use it.
  const shortLabel = (code: string) =>
    code === 'transferLines' ? t.grantShortLines : code === 'transferPos' ? t.grantShortPos : code === 'transferAgents' ? t.grantShortAgents : grantLabel(t, code);
  const columns: Column<RoleRow>[] = [
    {
      key: 'role',
      header: t.role,
      render: (row) => <><strong>{roleTitle(row)}</strong><span className={CELL_SUB}>{row.kind === 'layer' ? t.layerRole : t.jobRole}</span></>,
    },
    ...GRANT_CODES.map((code): Column<RoleRow> => ({
      key: code,
      header: shortLabel(code),
      render: (row) => {
        const layer = layerOf(row);
        if (!grantUsable(code, layer)) return <span className="text-muted opacity-50" aria-label={t.grantUnusable}>—</span>;
        const on = codesOf(row).includes(code);
        return on
          ? <span className={cn(GRANT, 'bg-success-soft text-success inset-ring-success')} data-testid="grant-on" role="img" aria-label={`${grantLabel(t, code, layer)}: ${t.grantAllowed}`}><Check size={14} strokeWidth={2.4} /></span>
          : <span className={GRANT} role="img" aria-label={`${grantLabel(t, code, layer)}: ${t.grantDenied}`} />;
      },
    })),
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => <RowMenu label={`${t.rowActions} ${roleTitle(row)}`} items={[{ label: t.grantEdit, icon: 'edit', onClick: () => edit(row) }]} />,
    },
  ];

  return (
    <Desk
      title={t.rolesTitle}
      lede={t.rolesLede}
      action={<Button type="button" onClick={() => edit()}><Plus size={16} aria-hidden="true" />{t.newRole}</Button>}
      error={failure}
      note={note}
    >
      <Pane>
        <Dialog
          open={open}
          title={draft.kind === 'layer' ? roleTitle(draft) : t.role}
          lede={t.roleHint}
          mark="shield"
          closeLabel={t.closeMenu}
          error={failure}
          onClose={() => setOpen(false)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t.cancel}</Button>
              <Button type="button" disabled={busy || rulesBad || (draft.kind === 'job' && !draft.name.trim())} onClick={save}>{t.save}</Button>
            </>
          )}
        >
          <div className={cn('grid gap-3', TWO_FACTOR_UNDER_GRANTS)}>
            {draft.kind === 'job' && (
              <Label tone="dialog">
                {t.role}
                <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </Label>
            )}
            {/* The grants in three groups, each a sliding switch per row (owner 2026-11-11); the layer's session rules under them. */}
            <section className="grid gap-0" aria-label={t.permissions}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className={BLOCK_TITLE}>{t.permissions}</h3>
                <span className="text-sm font-medium text-muted tabular-nums">{t.grantsOn.replace('{n}', String(groups.reduce((sum, group) => sum + group.codes.filter((code) => draft.grants.includes(code)).length, 0))).replace('{total}', String(groups.reduce((sum, group) => sum + group.codes.length, 0)))}</span>
              </div>
              {groups.map((group) => {
                const title = t[GROUP_TITLE[group.key]];
                return (
                  <div
                    key={group.key}
                    className="grid grid-cols-[148px_minmax(0,1fr)] gap-x-4 border-t border-line py-1 max-sm:grid-cols-[minmax(0,1fr)] max-sm:pt-3 max-sm:pb-1"
                    role="group"
                    aria-label={title}
                  >
                    <div className="pt-2.25 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:pt-0">
                      <h4 className="m-0 text-[12.5px] leading-[1.3] font-bold text-ink">{title}</h4>
                      <span className="mt-0.5 block text-sm text-muted tabular-nums max-sm:m-0 max-sm:inline"><bdi dir="ltr">{group.codes.filter((code) => draft.grants.includes(code)).length}/{group.codes.length}</bdi></span>
                    </div>
                    <div className="grid min-w-0 max-sm:pt-1">
                      {group.codes.map((code) => {
                        const on = draft.grants.includes(code);
                        const name = grantLabel(t, code, layerOf(draft));
                        const set = (next: boolean) => setDraft((current) => ({
                          ...current,
                          grants: next ? [...current.grants.filter((item) => item !== code), code] : current.grants.filter((item) => item !== code),
                        }));
                        return (
                          // The whole row is the target: a click anywhere on it flips the switch at its end.
                          <div
                            key={code}
                            className="flex min-h-8.5 cursor-pointer items-center justify-between gap-3 not-first:border-t not-first:border-line-soft max-sm:min-h-11"
                            data-on={on}
                            onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) set(!on); }}>
                            <span className={cn('text-md', on ? 'font-bold text-ink' : 'font-medium text-muted')}>{name}</span>
                            <LiveSwitch label={name} checked={on} onChange={set} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
            {layerKey && rules.data && ruleValues ? (
              <section className={cn('grid gap-0', UNDER_GRANTS)} aria-label={t.sessionRulesTitle}>
                <h3 className={BLOCK_TITLE}>{t.sessionRulesTitle}</h3>
                <p className="mx-0 mt-1 mb-3 text-sm leading-[1.5] text-muted">{t.layerSessionHint}</p>
                <RuleSelects values={ruleValues} fallback={rules.data.defaults} fallbackLabel={t.followDefault} onChange={setRuleDraft} />
              </section>
            ) : null}
            {layerKey && policyValue ? <LayerTwoFactor value={policyValue} onChange={setPolicyDraft} /> : null}
          </div>
        </Dialog>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} loading={!roles.loaded} failed={roles.error} onRetry={() => void roles.reload()} empty={t.noMatches} skeleton={{ rows: 4, columns: 4 }} cards={false} />
      </Pane>
    </Desk>
  );
}
