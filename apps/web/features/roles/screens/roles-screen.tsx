'use client';

import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { RowMenu } from '../../../components/row-menu';
import { Button } from '../../../components/ui/button';
import { api, type RoleRow } from '../../../lib/api';
import { GRANT_CODES, grantLabel, grantUsable } from '../../../lib/grants';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';

type RoleDraft = { id: string; name: string; kind: 'layer' | 'job'; layer: string; grants: string[] };

const FLAG_KEYS = ['read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter'] as const;

function codesOf(row: RoleRow) {
  if (row.grants && row.grants.length > 0) return [...row.grants];
  return FLAG_KEYS.filter((key) => row[key]);
}

const emptyDraft = (): RoleDraft => ({ id: '', name: '', kind: 'job', layer: '', grants: ['read'] });

// A job role has no layer of its own: it belongs to the branch, so it is worded and offered as the branch's.
const layerOf = (role: { layer?: string }) => role.layer || 'branch';

export function RolesScreen() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const roles = useLoad(async () => {
    const result = await api.officeRoles();
    return result.ok ? { ok: true as const, data: result.data.roles } : result;
  });
  const rows = roles.data ?? [];
  const { run, busy } = useAction({ setError, setNote, onDone: roles.reload });
  const failure = error;

  function edit(row?: RoleRow) {
    setDraft(row
      ? { id: row.id, name: row.name, kind: row.kind === 'layer' ? 'layer' : 'job', layer: row.layer ?? '', grants: codesOf(row) }
      : emptyDraft());
    setOpen(true);
  }

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
    await run(() => api.saveRole({ id: draft.id || undefined, name: draft.name, grants: draft.grants, ...flags }), { then: () => setOpen(false) });
  }

  function roleTitle(row: { kind?: string; layer?: string; name: string }) {
    return row.kind === 'layer' && row.layer ? layerName(t, row.layer) : row.name;
  }

  function labels(row: RoleRow) {
    const layer = layerOf(row);
    return codesOf(row).filter((code) => grantUsable(code, layer)).map((code) => grantLabel(t, code, layer)).join(' · ') || '—';
  }

  const columns: Column<RoleRow>[] = [
    { key: 'role', header: t.role, render: (row) => <strong>{roleTitle(row)}</strong> },
    { key: 'kind', header: t.layer, render: (row) => row.kind === 'layer' ? t.layerRole : t.jobRole },
    { key: 'permissions', header: t.permissions, render: (row) => labels(row) },
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
      lede=""
      action={<Button type="button" onClick={() => edit()}>{t.role}</Button>}
      error={failure}
      note={note}
    >
      <section className="pane fit">
        <header className="pane-head">
          <h2>{t.rolesList}{roles.loaded ? <span className="count">{rows.length}</span> : null}</h2>
        </header>
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
              <Button type="button" disabled={busy || (draft.kind === 'job' && !draft.name.trim())} onClick={save}>{t.save}</Button>
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
            <fieldset className="perm-grid">
              <legend>{t.permissions}</legend>
              {GRANT_CODES.filter((code) => grantUsable(code, layerOf(draft))).map((code) => (
                <label key={code} className="check">
                  <input
                    type="checkbox"
                    checked={draft.grants.includes(code)}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      grants: event.target.checked
                        ? [...current.grants, code]
                        : current.grants.filter((item) => item !== code),
                    }))}
                  />
                  {grantLabel(t, code, layerOf(draft))}
                </label>
              ))}
            </fieldset>
          </div>
        </Dialog>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} loading={!roles.loaded} failed={roles.error} onRetry={() => void roles.reload()} empty={t.noMatches} skeleton={{ rows: 4, columns: 4 }} />
      </section>
    </Desk>
  );
}
