'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, Money, latinWhen } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { api, type AccountingRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function AccountingPage() {
  const { t, apiText } = usePrefs();
  const [entries, setEntries] = useState<AccountingRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const result = await api.officeAccounting();
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

  const shown = query ? entries.filter((row) => row.msisdn.includes(query.trim())) : entries;

  return (
    <Desk title={t.navAccounting} lede="" error={error} note="">
      <div className="filter-bar">
        <div className="filter-panel">
          <label>
            {t.numberSearch}
            <input value={query} dir="ltr" onChange={(event) => setQuery(event.target.value)} />
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
                  <th>{t.when}</th>
                  <th>{t.number}</th>
                  <th>{t.company}</th>
                  <th>{t.packageName}</th>
                  <th className="num">{t.packagePrice}</th>
                  <th className="num">{t.balanceBefore}</th>
                  <th className="num">{t.balanceAfter}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td className="when"><bdi dir="ltr">{latinWhen(row.at)}</bdi></td>
                    <td className="fit"><bdi dir="ltr">{row.msisdn}</bdi></td>
                    <td>{row.companyName || '—'}</td>
                    <td>{row.packageName || '—'}</td>
                    <td className="num"><Money value={row.packagePrice} /></td>
                    <td className="num"><Money value={row.balanceBefore} /></td>
                    <td className="num"><Money value={row.balanceAfter} /></td>
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
