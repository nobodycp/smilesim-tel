'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, actionName, taskStatus } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { RowMenu } from '../../components/row-menu';
import { api, type TaskRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function TasksPage() {
  const { t, apiText } = usePrefs();
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [focus, setFocus] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const result = await api.officeTasks();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setRows(result.data.tasks);
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    setFocus(new URLSearchParams(window.location.search).get('status') ?? '');
    load();
  }, [load]);

  async function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError('');
    setNote('');
    const result = await work();
    if (!result.ok) {
      setError(apiText(result.message ?? 'حدث خطأ'));
      return;
    }
    setNote(t.save);
    await load();
  }

  const shown = focus ? rows.filter((row) => row.status === focus) : rows;

  return (
    <Desk title={t.tasksTitle} lede="" error={error} note={note}>
      <div className="filter-bar">
        <label>
          {t.status}
          <select value={focus} onChange={(event) => setFocus(event.target.value)}>
            <option value="">{t.allRows}</option>
            <option value="pending">{taskStatus(t, 'pending')}</option>
            <option value="working">{taskStatus(t, 'working')}</option>
            <option value="done">{taskStatus(t, 'done')}</option>
            <option value="cancelled">{taskStatus(t, 'cancelled')}</option>
          </select>
        </label>
      </div>
      <section className="pane">
        {!loaded ? <TableSkeleton rows={5} columns={6} /> : shown.length === 0 ? (
          <p className="empty" style={{ padding: 14 }}>
            {t.noTasks}
          </p>
        ) : (
          <div className="sheet">
            <table className="data">
              <thead>
                <tr>
                  <th>{t.status}</th>
                  <th>{t.movement}</th>
                  <th>{t.number}</th>
                  <th>{t.pointOfSale}</th>
                  <th className="num">{t.amount}</th>
                  <th>{t.note}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const items = [
                    ...(row.canTake ? [{ label: t.take, onClick: () => run(() => api.takeTask(row.id)) }] : []),
                    ...(row.canWork
                      ? [
                          { label: t.complete, onClick: () => run(() => api.completeTask(row.id, '')) },
                          { label: t.reject, danger: true, onClick: () => run(() => api.rejectTask(row.id, reasons[row.id] ?? '')) },
                          { label: t.release, onClick: () => run(() => api.releaseTask(row.id)) },
                        ]
                      : []),
                    ...(row.canCancel ? [{ label: t.cancelTask, danger: true, onClick: () => run(() => api.cancelTask(row.id)) }] : []),
                  ];
                  const visible = items.find((item) => !item.danger);
                  const rest = items.filter((item) => item !== visible);
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className={row.status === 'done' ? 'badge' : row.status === 'cancelled' ? 'badge cancelled' : 'badge pending'}>{taskStatus(t, row.status)}</span>
                      </td>
                      <td>
                        {actionName(t, row.action)} · {row.packageName}
                      </td>
                      <td dir="ltr">{row.msisdn ?? '—'}</td>
                      <td>{row.posLogin}</td>
                      <td>
                        <Money value={row.posDelta} />
                      </td>
                      <td>{[row.log, row.resultNote || row.note].filter(Boolean).join(' — ') || '—'}</td>
                      <td>
                        <div className="ops">
                          {visible && (
                            <button type="button" className="secondary" onClick={visible.onClick}>
                              {visible.label}
                            </button>
                          )}
                          {row.canWork && (
                            <input
                              aria-label={t.reason}
                              value={reasons[row.id] ?? ''}
                              onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))}
                            />
                          )}
                          {rest.length > 0 && <RowMenu label={t.lineOps} items={rest} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Desk>
  );
}
