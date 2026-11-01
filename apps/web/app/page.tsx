'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Money, actionName, latinWhen, layerName } from '../components/desk';
import { Icon, type IconName } from '../components/icon';
import { Spinner, TableSkeleton } from '../components/loading';
import { OfficeShell } from '../components/office-shell';
import { Stat, StatRow } from '../components/stat';
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

  const shortcuts: { href: string; label: string; icon: IconName }[] = layer === 'pos'
    ? [
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/packages', label: t.navPlans, icon: 'plans' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        { href: '/operations', label: t.navOperations, icon: 'plans' },
      ]
    : [
        { href: '/users', label: t.navUsers, icon: 'staff' },
        ...(me?.isBranchOwner ? [{ href: '/roles', label: t.navRoles, icon: 'lock' as const }] : []),
        { href: '/packages', label: t.navPlans, icon: 'plans' },
        { href: '/numbers', label: t.navNumbers, icon: 'numbers' },
        { href: '/tasks', label: t.navTasks, icon: 'tasks' },
        ...(layer === 'branch' ? [{ href: '/companies', label: t.navCompanies, icon: 'providers' as const }] : []),
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
          {/* Stat stays presentational so non-link KPIs can reuse it; the link wraps it here. */}
          <StatRow>
            <Link className="stat-link" href="/tasks?status=pending">
              <Stat icon="tasks" tone="warning" label={t.navTasks} value={home ? home.pendingTasks : <span className="skeleton sk-num" />} meta={t.pending} />
            </Link>
            <Link className="stat-link" href="/numbers?status=active">
              <Stat icon="numbers" tone="success" label={t.activeLines} value={home ? home.activeLines : <span className="skeleton sk-num" />} meta={t.lineActive} />
            </Link>
            <Link className="stat-link" href="/numbers?status=disconnected">
              <Stat icon="numbers" tone="danger" label={t.inactiveLines} value={home ? home.inactiveLines : <span className="skeleton sk-num" />} meta={t.lineDisconnected} />
            </Link>
          </StatRow>
        </section>
        {me && (
          <section>
            <p className="section-label">{t.shortcuts}</p>
            <div className="shortcut-row">
              {shortcuts.map((item) => (
                <Link key={item.label} className="shortcut" href={item.href}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
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
