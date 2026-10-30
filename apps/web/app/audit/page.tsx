'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Desk, actionName, latinWhen, taskStatus } from '../../components/desk';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type AuditRow } from '../../lib/api';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

export default function AuditPage() {
  const { t, apiText } = usePrefs();
  const { me } = useOffice();
  const branch = me?.layer === 'branch';
  const [page, setPage] = useState<{ key: string; entries: AuditRow[]; next: string | null } | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  const ticket = useRef(0);
  const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', ...(branch ? ['enter'] : [])];
  const current = page?.key === kind ? page : null;
  const shown = current?.entries ?? [];

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    const result = await api.officeAudit({ kind });
    if (mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      setPage({ key: kind, entries: [], next: null });
      return;
    }
    setError('');
    setPage({ key: kind, entries: result.data.entries, next: result.data.nextCursor });
  }, [apiText, kind]);

  async function loadMore() {
    if (!current?.next || more) return;
    setMore(true);
    const result = await api.officeAudit({ kind, cursor: current.next });
    setMore(false);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setPage((now) => (now && now.key === kind ? { key: kind, entries: [...now.entries, ...result.data.entries], next: result.data.nextCursor } : now));
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Desk title={t.navAudit} lede="" error={error} note="">
      <div className="filter-bar">
        <div className="filter-panel">
          <label>
            {t.kind}
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t.allRows}</option>
              {kinds.map((value) => (
                <option key={value} value={value}>{actionName(t, value)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <section className="pane">
        <div className="sheet">
          {!current ? (
            <TableSkeleton rows={6} columns={7} />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>{t.kind}</th>
                  <th>{t.when}</th>
                  <th>{t.number}</th>
                  <th>{t.company}</th>
                  <th>{t.packageName}</th>
                  {branch && <th>{t.provider}</th>}
                  <th>{t.actedBy}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>{actionName(t, row.action)}</td>
                    <td className="when"><bdi dir="ltr">{latinWhen(row.at)}</bdi></td>
                    <td className="fit">{row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—'}</td>
                    <td>{row.companyName || '—'}</td>
                    <td>{row.packageName || '—'}</td>
                    {branch && <td>{row.providerName || '—'}</td>}
                    <td>{row.actorName || '—'}</td>
                    <td>{taskStatus(t, row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {current && shown.length === 0 && <p className="empty">{t.noMovements}</p>}
        </div>
        {current?.next && (
          <div className="pane-body">
            <div className="pane-tools">
              <button type="button" className="secondary" disabled={more} onClick={loadMore}>{t.loadMore}</button>
              {more && <Spinner size={18} />}
              <span className="hint">{t.shownCount.replace('{n}', String(shown.length))}</span>
            </div>
          </div>
        )}
      </section>
    </Desk>
  );
}
