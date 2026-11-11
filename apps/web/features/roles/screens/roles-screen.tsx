'use client';

import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Check, Plus } from 'lucide-react';
import { Desk, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { api, type RoleRow } from '../../../lib/api';
import type { LayerKey, SessionRuleValues } from '../../../lib/api-types';
import { RuleSelects, sessionRulesValid } from '../../auth/session-rules';
import { LiveSwitch } from '../../../components/live-switch';
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

const GROUP_TITLE = { view: 'grantGroupView', work: 'grantGroupWork', accounts: 'grantGroupAccounts' } as const satisfies Record<GrantGroupKey, string>;

export function RolesScreen() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const roles = useApiQuery(sharedKeys.roles, () => api.officeRoles());
  const rows = roles.data?.roles ?? [];
  const { run, busy } = useAction({ setError, setNote, onDone: roles.reload });
  const failure = error;

  function edit(row?: RoleRow) {
    setRuleDraft(null);
    setDraft(row
      ? { id: row.id, name: row.name, kind: row.kind === 'layer' ? 'layer' : 'job', layer: row.layer ?? '', grants: codesOf(row) }
      : emptyDraft());
    setOpen(true);
  }

  // A layer role carries its layer's session defaults (spec 2026-11-09-admin-review, 6.1): open sessions and idle
  // time for every account of the layer that has no value of its own.
  const rules = useApiQuery(['auth', 'session-rules'], () => api.sessionRules(), { enabled: open && draft.kind === 'layer' });
  const [ruleDraft, setRuleDraft] = useState<SessionRuleValues | null>(null);
  const layerKey = (draft.kind === 'layer' ? draft.layer : '') as LayerKey | '';
  const ruleValues = ruleDraft ?? (layerKey && rules.data ? rules.data.layers[layerKey] : null);
  const groups = grantGroupsFor(layerOf(draft));
  // «حفظ» waits while a session value is outside its range.
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
      if (!saved.ok || !layerKey || !ruleDraft) return saved.ok ? { ok: true as const, data: null } : saved;
      const ruled = await api.setLayerSessionRules(layerKey, ruleDraft);
      return ruled.ok ? { ok: true as const, data: null } : ruled;
    }, { then: () => { setOpen(false); setRuleDraft(null); void rules.reload(); } });
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
      render: (row) => <><strong>{roleTitle(row)}</strong><span className="sub">{row.kind === 'layer' ? t.layerRole : t.jobRole}</span></>,
    },
    ...GRANT_CODES.map((code): Column<RoleRow> => ({
      key: code,
      header: shortLabel(code),
      cell: 'grant-cell',
      render: (row) => {
        const layer = layerOf(row);
        if (!grantUsable(code, layer)) return <span className="grant-none" aria-label={t.grantUnusable}>—</span>;
        const on = codesOf(row).includes(code);
        return on
          ? <span className="grant on" role="img" aria-label={`${grantLabel(t, code, layer)}: ${t.grantAllowed}`}><Check size={14} strokeWidth={2.4} /></span>
          : <span className="grant" role="img" aria-label={`${grantLabel(t, code, layer)}: ${t.grantDenied}`} />;
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
      <section className="pane fit roles-matrix">
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
          <div className="dialog-form">
            {draft.kind === 'job' && (
              <label>
                {t.role}
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
            )}
            {/* The grants in three groups, each a sliding switch per row (owner 2026-11-11); the layer's session rules under them. */}
            <section className="role-block" aria-label={t.permissions}>
              <div className="role-sec-head">
                <h3>{t.permissions}</h3>
                <span className="role-sum">{t.grantsOn.replace('{n}', String(groups.reduce((sum, group) => sum + group.codes.filter((code) => draft.grants.includes(code)).length, 0))).replace('{total}', String(groups.reduce((sum, group) => sum + group.codes.length, 0)))}</span>
              </div>
              {groups.map((group) => {
                const title = t[GROUP_TITLE[group.key]];
                return (
                  <div key={group.key} className="role-group" role="group" aria-label={title}>
                    <div className="role-rail">
                      <h4>{title}</h4>
                      <span className="role-count"><bdi dir="ltr">{group.codes.filter((code) => draft.grants.includes(code)).length}/{group.codes.length}</bdi></span>
                    </div>
                    <div className="role-rows">
                      {group.codes.map((code) => {
                        const on = draft.grants.includes(code);
                        const name = grantLabel(t, code, layerOf(draft));
                        const set = (next: boolean) => setDraft((current) => ({
                          ...current,
                          grants: next ? [...current.grants.filter((item) => item !== code), code] : current.grants.filter((item) => item !== code),
                        }));
                        return (
                          // The whole row is the target: a click anywhere on it flips the switch at its end.
                          <div key={code} className="role-row" data-on={on} onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) set(!on); }}>
                            <span className="role-name">{name}</span>
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
              <section className="role-block role-sessions" aria-label={t.sessionRulesTitle}>
                <h3>{t.sessionRulesTitle}</h3>
                <p className="role-hint">{t.layerSessionHint}</p>
                <RuleSelects values={ruleValues} fallback={rules.data.defaults} fallbackLabel={t.followDefault} onChange={setRuleDraft} />
              </section>
            ) : null}
          </div>
        </Dialog>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} loading={!roles.loaded} failed={roles.error} onRetry={() => void roles.reload()} empty={t.noMatches} skeleton={{ rows: 4, columns: 4 }} />
      </section>
    </Desk>
  );
}
