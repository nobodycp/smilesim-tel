'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, actionName, latinWhen } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { api, type LedgerRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function OperationsPage() {
  const { t, apiText } = usePrefs();
  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim'];

  const load = useCallback(async () => {
    const result = await api.officeLedger('operations', { kind, direction, from, to });
    if (!result.ok) {
      setError(apiText(result.message));
      setEntries([]);
      setLoaded(true);
      return;
    }
    setError('');
    setEntries(result.data.entries);
    setLoaded(true);
  }, [apiText, kind, direction, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Desk title={t.navOperations} lede="" error={error} note="">
      <div className="filter-bar">
        <div className="filter-panel">
          <label>
            {t.kind}
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t.allRows}</option>
              {kinds.map((item) => (
                <option key={item} value={item}>{actionName(t, item)}</option>
              ))}
            </select>
          </label>
          <label>
            {t.direction}
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="">{t.allRows}</option>
              <option value="in">{t.increase}</option>
              <option value="out">{t.decrease}</option>
            </select>
          </label>
          <label>
            {t.from}
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            {t.to}
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
      </div>
      <section className="pane">
        <div className="sheet">
          {!loaded ? <TableSkeleton rows={6} columns={7} /> : (
            <table className="data">
              <thead>
                <tr>
                  <th>{t.when}</th>
                  <th>{t.kind}</th>
                  <th>{t.number}</th>
                  <th>{t.note}</th>
                  <th className="num">{t.amount}</th>
                  <th className="num">{t.balanceBefore}</th>
                  <th className="num">{t.balanceAfter}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td className="when"><bdi dir="ltr">{latinWhen(row.at)}</bdi></td>
                    <td>{actionName(t, row.kind)}</td>
                    <td>{row.msisdn ? <bdi dir="ltr">{row.msisdn}</bdi> : '—'}</td>
                    <td>{row.packageName || row.note || ''}</td>
                    <td className="num"><Money value={row.amount} /></td>
                    <td className="num"><Money value={row.balanceBefore} /></td>
                    <td className="num"><Money value={row.balanceAfter} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {loaded && entries.length === 0 && <p className="empty">{t.noMovements}</p>}
        </div>
      </section>
    </Desk>
  );
}
