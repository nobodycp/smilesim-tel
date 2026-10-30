'use client';

import { useCallback, useEffect, useState } from 'react';
import { Desk, Money } from '../../components/desk';
import { TableSkeleton } from '../../components/loading';
import { api, type AccountingRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function AccountingPage() {
  const { t, locale, apiText } = usePrefs();
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
        <label>
          {t.numberSearch}
          <input value={query} dir="ltr" onChange={(event) => setQuery(event.target.value)} />
        </label>
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
                  <th>{t.packagePrice}</th>
                  <th>{t.balanceBefore}</th>
                  <th>{t.balanceAfter}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.at).toLocaleString(locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ar')}</td>
                    <td><bdi dir="ltr">{row.msisdn}</bdi></td>
                    <td>{row.companyName || '—'}</td>
                    <td>{row.packageName || '—'}</td>
                    <td><Money value={row.packagePrice} /></td>
                    <td><Money value={row.balanceBefore} /></td>
                    <td><Money value={row.balanceAfter} /></td>
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
