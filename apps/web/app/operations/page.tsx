'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Desk, Money, actionName, latinWhen } from '../../components/desk';
import { Spinner, TableSkeleton } from '../../components/loading';
import { api, type LedgerRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';

export default function OperationsPage() {
  const { t, apiText } = usePrefs();
  const [page, setPage] = useState<{ key: string; entries: LedgerRow[]; next: string | null } | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const ticket = useRef(0);
  const kinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim'];
  const filterKey = `${kind}|${direction}|${from}|${to}`;
  const current = page?.key === filterKey ? page : null;
  const entries = current?.entries ?? [];

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    const key = `${kind}|${direction}|${from}|${to}`;
    const result = await api.officeLedger('operations', { kind, direction, from, to });
    if (mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      setPage({ key, entries: [], next: null });
      return;
    }
    setError('');
    setPage({ key, entries: result.data.entries, next: result.data.nextCursor });
  }, [apiText, kind, direction, from, to]);

  async function loadMore() {
    if (!current?.next || more) return;
    const key = current.key;
    setMore(true);
    const result = await api.officeLedger('operations', { kind, direction, from, to, cursor: current.next });
    setMore(false);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setPage((now) => (now && now.key === key ? { key, entries: [...now.entries, ...result.data.entries], next: result.data.nextCursor } : now));
  }

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
          {!current ? <TableSkeleton rows={6} columns={7} /> : (
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
          {current && entries.length === 0 && <p className="empty">{t.noMovements}</p>}
        </div>
        {current?.next && (
          <div className="pane-body">
            <div className="pane-tools">
              <button type="button" className="secondary" disabled={more} onClick={loadMore}>{t.loadMore}</button>
              {more && <Spinner size={18} />}
              <span className="hint">{t.shownCount.replace('{n}', String(entries.length))}</span>
            </div>
          </div>
        )}
      </section>
    </Desk>
  );
}
