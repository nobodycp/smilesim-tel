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
        <div className="filter-panel">
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
                  <th className="row-actions">{t.lineOps}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const items = [
                    ...(row.canTake ? [{ label: t.take, icon: 'enter' as const, onClick: () => run(() => api.takeTask(row.id)) }] : []),
                    ...(row.canWork
                      ? [
                          { label: t.complete, icon: 'check' as const, onClick: () => run(() => api.completeTask(row.id, '')) },
                          { label: t.reject, icon: 'ban' as const, danger: true, onClick: () => run(() => api.rejectTask(row.id, reasons[row.id] ?? '')) },
                          { label: t.release, icon: 'undo' as const, onClick: () => run(() => api.releaseTask(row.id)) },
                        ]
                      : []),
                    ...(row.canCancel ? [{ label: t.cancelTask, icon: 'ban' as const, danger: true, onClick: () => run(() => api.cancelTask(row.id)) }] : []),
                  ];
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className={row.status === 'done' ? 'badge' : row.status === 'cancelled' ? 'badge cancelled' : 'badge pending'}>{taskStatus(t, row.status)}</span>
                      </td>
                      <td>
                        {actionName(t, row.action)} · {row.packageName}
                      </td>
                      <td className="msisdn"><bdi dir="ltr">{row.msisdn ?? '—'}</bdi></td>
                      <td><bdi dir="ltr">{row.posLogin}</bdi></td>
                      <td className="num">
                        <Money value={row.posDelta} />
                      </td>
                      <td>
                        {[row.log, row.resultNote || row.note].filter(Boolean).join(' — ') || '—'}
                        {row.canWork && (
                          <input
                            aria-label={t.reason}
                            value={reasons[row.id] ?? ''}
                            onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))}
                          />
                        )}
                      </td>
                      <td className="row-actions">
                        <RowMenu label={`${t.lineOps} ${row.msisdn ?? row.id}`} items={items} />
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
