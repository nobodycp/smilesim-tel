'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Money, actionName, latinWhen, layerName } from '../components/desk';
import { Spinner, TableSkeleton } from '../components/loading';
import { OfficeShell } from '../components/office-shell';
import { api, type HomePayload } from '../lib/api';
import { useIdentity } from '../lib/identity';
import { useOffice } from '../lib/office-session';
import { usePrefs } from '../lib/prefs';

export default function HomePage() {
  const { t, apiText } = usePrefs();
  const saved = useIdentity();
  const { me } = useOffice();
  const account = me ? me.nickname || me.loginName : saved.account;
  const hint = me && me.nickname ? me.loginName : saved.hint || undefined;
  const layer = me?.layer ?? '';
  const [home, setHome] = useState<HomePayload | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    const board = await api.officeHome();
    if (!board.ok) {
      setError(apiText(board.message));
      return;
    }
    setHome(board.data);
  }

  useEffect(() => {
    load();
    // The first paint loads the signed-in desk. Later refreshes go through load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNote('');
    const result = await api.postAnnouncement(draft);
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    setDraft('');
    setNote(t.posted);
    await load();
  }

  const shortcuts = layer === 'pos'
    ? [
        { href: '/numbers', label: t.navNumbers },
        { href: '/packages', label: t.navPlans },
        { href: '/tasks', label: t.navTasks },
        { href: '/operations', label: t.navOperations },
      ]
    : [
        { href: '/users', label: t.navUsers },
        ...(me?.isBranchOwner ? [{ href: '/roles', label: t.navRoles }] : []),
        { href: '/packages', label: t.navPlans },
        { href: '/numbers', label: t.navNumbers },
        { href: '/tasks', label: t.navTasks },
        ...(layer === 'branch' ? [{ href: '/companies', label: t.navCompanies }] : []),
      ];

  return (
    <OfficeShell account={account} hint={hint} wide>
      <div className="home">
        {error && <p className="error banner" role="alert">{error}</p>}
        {note && <p className="note banner" role="status">{note}</p>}
        <header className="page-head">
          <h1>{t.homeTitle}</h1>
          {layer && <p className="lede">{layerName(t, layer)}</p>}
        </header>
        <section className="home-access">
          <p className="section-label">{t.quickAccess}</p>
          <div className="stat-row">
            <Link className="stat-card" href="/tasks?status=pending">
              <span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg></span>
              <span>{t.navTasks}</span>
              <strong>{home ? home.pendingTasks : <span className="skeleton sk-num" />}</strong>
              <small>{t.pending}</small>
            </Link>
            <Link className="stat-card" href="/numbers?status=active">
              <span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4h10v16H7zM10 18h4" /></svg></span>
              <span>{t.activeLines}</span>
              <strong>{home ? home.activeLines : <span className="skeleton sk-num" />}</strong>
              <small>{t.lineActive}</small>
            </Link>
            <Link className="stat-card" href="/numbers?status=disconnected">
              <span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h16M4 16h10" /></svg></span>
              <span>{t.inactiveLines}</span>
              <strong>{home ? home.inactiveLines : <span className="skeleton sk-num" />}</strong>
              <small>{t.lineDisconnected}</small>
            </Link>
          </div>
        </section>
        {me && (
          <section>
            <p className="section-label">{t.shortcuts}</p>
            <div className="shortcut-row">
              {shortcuts.map((item) => (
                <Link key={item.label} className="shortcut" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </section>
        )}
        <div className="home-grid">
          {!home ? (
            <>
              <section className="pane">
                <header className="pane-head"><h2>{t.lastOps}</h2><Spinner /></header>
                <TableSkeleton rows={5} columns={4} />
              </section>
              <section className="pane">
                <header className="pane-head"><h2>{t.board}</h2><Spinner /></header>
                <TableSkeleton rows={4} columns={1} />
              </section>
            </>
          ) : <>
          <section className="pane">
            <header className="pane-head">
              <h2>{t.lastOps}</h2>
            </header>
            {home.operations.length === 0 ? (
              <p className="empty" style={{ padding: 14 }}>{t.noMovements}</p>
            ) : (
              <div className="sheet">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t.when}</th>
                      <th>{t.movement}</th>
                      <th>{t.pointOfSale}</th>
                      <th className="num">{t.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {home.operations.map((row) => (
                      <tr key={row.id}>
                        <td className="when"><bdi dir="ltr">{latinWhen(row.at)}</bdi></td>
                        <td>{actionName(t, row.kind)}{row.note ? ` · ${row.note}` : ''}</td>
                        <td>{row.loginName}</td>
                        <td><Money value={row.amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="pane">
            <header className="pane-head">
              <h2>{t.board}</h2>
            </header>
            <div className="pane-body">
              {home.canPost && (
                <form onSubmit={publish}>
                  <label>
                    {t.announcementText}
                    <textarea value={draft} maxLength={400} onChange={(event) => setDraft(event.target.value)} />
                  </label>
                  <p className="hint">{t.announcementHint}</p>
                  <button type="submit" disabled={!draft.trim()}>{t.postAnnouncement}</button>
                </form>
              )}
              {home.announcements.length === 0 ? (
                <p className="empty">{t.noAnnouncements}</p>
              ) : (
                <ul className="notices">
                  {home.announcements.map((row) => (
                    <li key={row.id}>
                      <p>{row.body}</p>
                      <small>
                        {row.authorName} · {layerName(t, row.authorLayer)} · <bdi dir="ltr">{latinWhen(row.at)}</bdi>
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>}
        </div>
      </div>
    </OfficeShell>
  );
}
