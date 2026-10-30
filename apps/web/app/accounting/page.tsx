'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Desk, Money, latinWhen } from '../../components/desk';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type AccountingRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function AccountingPage() {
  const { t, apiText } = usePrefs();
  const [page, setPage] = useState<{ key: string; entries: AccountingRow[]; next: string | null } | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [needle, setNeedle] = useState('');
  const ticket = useRef(0);
  const current = page?.key === needle ? page : null;
  const shown = current?.entries ?? [];

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    const result = await api.officeAccounting({ q: needle });
    if (mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      setPage({ key: needle, entries: [], next: null });
      return;
    }
    setError('');
    setPage({ key: needle, entries: result.data.entries, next: result.data.nextCursor });
  }, [apiText, needle]);

  async function loadMore() {
    if (!current?.next || more) return;
    setMore(true);
    const result = await api.officeAccounting({ q: needle, cursor: current.next });
    setMore(false);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setPage((now) => (now && now.key === needle ? { key: needle, entries: [...now.entries, ...result.data.entries], next: result.data.nextCursor } : now));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

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
          {!current ? (
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
