'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk } from '../../components/desk';
import { Dialog } from '../../components/dialog';
import { RowMenu } from '../../components/row-menu';
import { TableSkeleton } from '../../components/loading';
import { api } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

type RoleRow = {
  id: string;
  name: string;
  read: boolean;
  edit: boolean;
  accounting: boolean;
  tasks: boolean;
  reports: boolean;
  staff: boolean;
  enter: boolean;
};

type RoleDraft = Omit<RoleRow, 'id'> & { id: string };

const emptyDraft = (): RoleDraft => ({
  id: '',
  name: '',
  read: true,
  edit: false,
  accounting: false,
  tasks: false,
  reports: false,
  staff: false,
  enter: false,
});

export default function RolesPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const grants = [
    ['read', t.grantRead],
    ['edit', t.grantEdit],
    ['accounting', t.navAccounting],
    ['tasks', t.navTasks],
    ['reports', t.navReports],
    ['staff', t.staffAccount],
    ['enter', t.grantEnter],
  ] as const;

  const load = useCallback(async () => {
    const result = await api.officeRoles();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setRows(result.data.roles);
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    load();
  }, [load]);

  function edit(row?: RoleRow) {
    setDraft(row ? { ...row } : emptyDraft());
    setOpen(true);
  }

  async function save() {
    setError('');
    setNote('');
    const result = await api.saveRole({ ...draft, id: draft.id || undefined });
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setOpen(false);
    await load();
  }

  function labels(row: RoleRow) {
    return grants.filter(([key]) => row[key]).map(([, label]) => label).join(' · ') || '—';
  }

  return (
    <Desk
      title={t.rolesTitle}
      lede=""
      action={<button type="button" className="primary" onClick={() => edit()}>{t.role}</button>}
      error={error}
      note={note}
    >
      <section className="pane">
        <Dialog open={open} title={draft.name || t.role} closeLabel={t.closeMenu} error={error} onClose={() => setOpen(false)}>
          <div className="dialog-form">
            <label>
              {t.role}
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            {grants.map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))}
                />
                {label}
              </label>
            ))}
            <button type="button" onClick={save}>{t.save}</button>
          </div>
        </Dialog>
        {!loaded ? <TableSkeleton rows={3} columns={3} /> : rows.length === 0 ? (
          <p className="empty">{t.noMatches}</p>
        ) : (
          <div className="sheet">
            <table className="data">
              <thead>
                <tr>
                  <th>{t.role}</th>
                  <th>{t.permissions}</th>
                  <th>{t.lineOps}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong></td>
                    <td>{labels(row)}</td>
                    <td>
                      <RowMenu label={t.lineOps} items={[{ label: t.grantEdit, onClick: () => edit(row) }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Desk>
  );
}
