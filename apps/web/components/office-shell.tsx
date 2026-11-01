'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type NoticeRow } from '../lib/api';
import { forgetIdentity, useIdentity } from '../lib/identity';
import { useDoor } from '../lib/door-context';
import { useOffice } from '../lib/office-session';
import { usePrefs } from '../lib/prefs';
import { LanguageSwitch, ThemeToggle } from './chrome';
import { ShellSearch } from './shell-search';
import { Icon, type IconName } from './icon';
import { PageSkeleton } from './loading';

const COLLAPSE_KEY = 'smilesim-sidebar-collapsed';

function noticeAction(t: ReturnType<typeof usePrefs>['t'], action: string) {
  if (action === 'activate' || action === 'reactivate') return t.actActivate;
  if (action === 'charge') return t.actCharge;
  if (action === 'extend') return t.extend;
  if (action === 'rename') return t.updateNumber;
  if (action === 'sim') return t.swapSim;
  if (action === 'disconnect') return t.actDisconnect;
  if (action === 'freeze') return t.actFreeze;
  if (action === 'unfreeze') return t.unfreeze;
  if (action === 'switch') return t.actSwitch;
  return action;
}

type NavItem = { label: string; href: string; icon: IconName; layers?: readonly string[]; grant?: string; owner?: boolean };

export function OfficeShell({
  account,
  hint,
  wide,
  children,
}: {
  account: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t, locale } = usePrefs();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [unread, setUnread] = useState(0);
  const { ready, me } = useOffice();
  const door = useDoor();
  const layer = door.layer;
  const balance = me ? me.balance : null;
  const ceiling = me?.ceiling ?? 0;
  const impersonating = me?.impersonating ?? false;
  const menuRef = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const saved = useIdentity();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Preference is optional.
    }
  }, []);

  async function leaveAccount() {
    const result = await api.leaveUser();
    if (result.ok) window.location.assign('/users');
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    const previous = document.body.style.overflow;
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!menuOpen && !walletOpen && !noticeOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!walletRef.current?.contains(event.target as Node)) setWalletOpen(false);
      if (!noticeRef.current?.contains(event.target as Node)) setNoticeOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen, walletOpen, noticeOpen]);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const pull = async () => {
      const result = await api.officeNotices();
      if (stop || !result.ok) return;
      setNotices(result.data.notices);
      setUnread(result.data.unread);
    };
    pull();
    const timer = window.setInterval(pull, 20000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Preference is optional.
      }
      return next;
    });
  }

  async function logout() {
    forgetIdentity();
    const listed = await api.listSessions();
    if (!listed.ok) return;
    const current = listed.data.sessions.find((session) => session.current);
    if (!current) return;
    await api.revokeSession(current.id);
    await api.listSessions();
  }

  const desk = ['branch', 'main_agent', 'agent'] as const;
  const groups: { title: string; items: NavItem[] }[] = [
    { title: '', items: [{ label: t.homeTitle, href: '/', icon: 'home' }] },
    {
      title: t.navOffice,
      items: [
        { label: t.navUsers, href: '/users', icon: 'staff', layers: desk },
        { label: t.navRoles, href: '/roles', icon: 'lock', layers: ['branch'], owner: true },
        { label: t.navPlans, href: '/packages', icon: 'plans' },
        { label: t.navNumbers, href: '/numbers', icon: 'numbers' },
      ],
    },
    {
      title: t.navOps,
      items: [
        { label: t.navCompanies, href: '/companies', icon: 'providers', layers: ['branch'], grant: 'edit' },
        { label: t.navTasks, href: '/tasks', icon: 'tasks' },
        { label: t.navOperations, href: '/operations', icon: 'plans' },
        { label: t.navAccounting, href: '/accounting', icon: 'wallet' },
        { label: t.navAudit, href: '/audit', icon: 'reports' },
      ],
    },
    {
      title: t.navReports,
      items: [
        { label: t.reportProviders, href: '/reports/providers', icon: 'reports', layers: ['branch'], grant: 'reports' },
        { label: t.reportConsumption, href: '/reports/consumption', icon: 'reports', layers: ['branch'], grant: 'reports' },
        { label: t.reportFunding, href: '/reports/funding', icon: 'wallet', layers: ['branch'], grant: 'reports' },
        { label: t.reportTasks, href: '/reports/tasks', icon: 'tasks', layers: ['branch'], grant: 'reports' },
        { label: t.reportNumbers, href: '/reports/numbers', icon: 'numbers', layers: ['branch'], grant: 'reports' },
        { label: t.reportOperations, href: '/reports/operations', icon: 'plans', layers: ['branch'], grant: 'reports' },
      ],
    },
  ];
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (!item.layers || item.layers.includes(layer)) && (!item.owner || me?.isBranchOwner) && (!item.grant || me?.isBranchOwner || me?.grants?.includes(item.grant))),
    }))
    .filter((group) => group.items.length > 0);

  const sidebar = (mobile: boolean) => {
    const compact = collapsed && !mobile;
    return (
      <>
        <div className={compact ? 'brand-block compact' : 'brand-block'}>
          {mobile && (
            <button type="button" className="icon-btn drawer-close" onClick={() => setMobileOpen(false)} aria-label={t.closeMenu}>
              <Icon name="close" />
            </button>
          )}
          <div className="brand-mark" aria-hidden="true">
            <Icon name="sim" />
          </div>
          {!compact && (
            <div className="brand-copy">
              <p className="brand-name">{t.brand}</p>
              <p className="brand-sub">{t[door.label]}</p>
            </div>
          )}
          <span className="brand-rule" aria-hidden="true" />
        </div>
        <nav className="side-nav" aria-label={t.mainNav}>
          {visibleGroups.map((group) => (
            <div key={group.title || 'home'}>
              {!compact && group.title && <p className="nav-label">{group.title}</p>}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname === item.href ? 'nav-link active' : 'nav-link'}
                  title={item.label}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon name={item.icon} />
                  {!compact && <span>{item.label}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <button
            type="button"
            className="nav-link collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? t.expand : t.collapse}
            aria-label={collapsed ? t.expand : t.collapse}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
            {!compact && <span>{t.collapse}</span>}
          </button>
        </div>
      </>
    );
  };

  const label = account || saved.account;
  const sub = hint || (!account ? saved.hint : '');
  const shown = me?.nickname || label;
  const first = shown.trim().split(/\s+/)[0] || shown;
  const initial = first.charAt(0);
  const now = new Date();
  const hello = now.getHours() < 12 ? t.goodMorning : now.getHours() < 18 ? t.goodAfternoon : t.goodEvening;
  const helloMark = locale === 'en' ? ',' : '،';
  const today = new Intl.DateTimeFormat(locale === 'en' ? 'en' : locale === 'he' ? 'he' : 'ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  const role = me?.layer === 'branch' ? t.layerBranch : me?.layer === 'main_agent' ? t.layerMain : me?.layer === 'agent' ? t.layerAgent : me?.layer === 'pos' ? t.layerPos : me?.layer === 'staff' ? t.staffAccount : '';

  return (
    <div className="office">
      {mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>{sidebar(false)}</aside>
      <aside className={mobileOpen ? 'drawer open' : 'drawer'}>{sidebar(true)}</aside>
      <div className="office-main">
        <header className="topbar">
          <div className="topbar-start">
            <button type="button" className="shell-icon menu-btn" onClick={() => setMobileOpen(true)} aria-label={t.openMenu}>
              <Icon name="menu" />
            </button>
            <div className="hello">
              <span className="hello-title">{hello}{helloMark} {first}</span>
              <span className="hello-date">{today}</span>
            </div>
          </div>
          <div className="topbar-tools">
            <ShellSearch />
            {balance !== null && (
              <div className="wallet-chip" ref={walletRef}>
                <button
                  type="button"
                  className="wallet-btn"
                  aria-haspopup="dialog"
                  aria-expanded={walletOpen}
                  aria-label={t.walletMenu}
                  onClick={() => setWalletOpen((open) => !open)}
                >
                  <Icon name="wallet" />
                  <span className={balance < 0 ? 'money neg' : balance > 0 ? 'money pos' : 'money'} dir="ltr">
                    {balance}
                  </span>
                </button>
                {walletOpen && (
                  <div className="wallet-pop" role="dialog" aria-label={t.walletMenu}>
                    <p>
                      <span>{t.balance}</span>
                      <strong className={balance < 0 ? 'money neg' : balance > 0 ? 'money pos' : 'money'} dir="ltr">{balance}</strong>
                    </p>
                    <p>
                      <span>{t.ceiling}</span>
                      <strong dir="ltr">{layer === 'branch' ? t.noCeiling : ceiling}</strong>
                    </p>
                    <p>
                      <span>{t.available}</span>
                      <strong dir="ltr">{layer === 'branch' ? t.noCeiling : balance + ceiling}</strong>
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="notice-wrap" ref={noticeRef}>
              <button
                type="button"
                className={unread > 0 ? 'shell-icon notice-btn is-active' : 'shell-icon notice-btn'}
                aria-label={t.notices}
                aria-expanded={noticeOpen}
                onClick={() => setNoticeOpen((open) => !open)}
              >
                <Icon name="bell" />
                {unread > 0 && <span className="notice-count">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {noticeOpen && (
                <div className="shell-panel" role="menu">
                  <p className="shell-panel-title">{t.notices}</p>
                  {notices.length === 0 ? (
                    <p className="shell-empty">{t.noNotices}</p>
                  ) : notices.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={row.read ? 'shell-item' : 'shell-item unread'}
                      onClick={async () => {
                        await api.readNotices(row.id);
                        setNoticeOpen(false);
                        window.location.assign(row.href);
                      }}
                    >
                      <strong>{row.kind === 'task_reply' ? t.noticeReply : t.noticeTask}</strong>
                      <small>{noticeAction(t, row.action)}{row.msisdn ? ` · ${row.msisdn}` : ''}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ThemeToggle shell />
            <LanguageSwitch shell />
            <div className="user-menu" ref={menuRef}>
              <button
                type="button"
                className="avatar-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t.userMenu}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span className="avatar" aria-hidden="true">{initial}</span>
              </button>
              {menuOpen && (
                <div className="shell-panel" role="menu">
                  <div className="shell-identity">
                    <span className="avatar" aria-hidden="true">{initial}</span>
                    <div>
                      <strong>{shown}</strong>
                      <small>{sub ? `@${sub}` : `@${me?.loginName ?? ''}`}{role ? ` · ${role}` : ''}</small>
                    </div>
                  </div>
                  <Link href="/settings" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <Icon name="settings" />
                    {t.accountSettings}
                  </Link>
                  <span className="shell-rule" />
                  <button type="button" className="danger" role="menuitem" onClick={logout}>
                    <Icon name="logout" />
                    {t.logout}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="canvas">
          {me && impersonating && (
            <div className="return-bar">
              <span>{label}</span>
              <button type="button" onClick={leaveAccount}>{t.returnAccount}</button>
            </div>
          )}
          <div className={wide ? 'canvas-inner wide' : 'canvas-inner'}>{ready ? children : <PageSkeleton />}</div>
        </main>
      </div>
    </div>
  );
}
