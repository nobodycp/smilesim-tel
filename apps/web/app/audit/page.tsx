'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, actionName, latinWhen, taskStatus } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { api, type AuditRow } from '../../lib/api';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';

export default function AuditPage() {
  const { t, apiText } = usePrefs();
  const { me } = useOffice();
  const branch = me?.layer === 'branch';
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');

  const load = useCallback(async () => {
    const result = await api.officeAudit();
    if (!result.ok) {
      setError(apiText(result.message));
      setEntries([]);
      setLoaded(true);
      return;
    }
    setError('');
    setEntries(result.data.entries);
    setLoaded(true);
  }, [apiText]);

  useEffect(() => {
    load();
  }, [load]);

  const kinds = [...new Set(entries.map((row) => row.action))];
  const shown = kind ? entries.filter((row) => row.action === kind) : entries;

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
          {!loaded ? (
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
          {loaded && shown.length === 0 && <p className="empty">{t.noMovements}</p>}
        </div>
      </section>
    </Desk>
  );
}
