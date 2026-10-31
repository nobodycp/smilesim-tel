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

type IconName =
  | 'home'
  | 'settings'
  | 'wallet'
  | 'bell'
  | 'plans'
  | 'numbers'
  | 'providers'
  | 'tasks'
  | 'staff'
  | 'reports'
  | 'lock'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'logout'
  | 'collapse'
  | 'expand'
  | 'sim';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M4 11.2 12 4.5l8 6.7" /><path d="M7 10.2V19.5h10V10.2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.2v1.8M12 19v1.8M4.9 6.2l1.3 1.3M17.8 16.5l1.3 1.3M3.2 12h1.8M19 12h1.8M4.9 17.8l1.3-1.3M17.8 7.5l1.3-1.3" /></>,
    wallet: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17M15.5 14h2" /></>,
    bell: <><path d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2H4.5L6 16z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    plans: <><path d="M7 4.5h7.2L18.5 8.8V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5z" /><path d="M8.5 13h7M8.5 16.5h5" /></>,
    numbers: <><rect x="8" y="3" width="8" height="18" rx="2" /><path d="M11 18.5h2" /></>,
    providers: <><path d="M5 8.5h14v9H5z" /><path d="M8 8.5V6.8A2.2 2.2 0 0 1 10.2 4.6h3.6A2.2 2.2 0 0 1 16 6.8v1.7" /></>,
    tasks: <><path d="M8 5.5h8M8 12h8M8 18.5h5" /><path d="M4.5 5.5h.01M4.5 12h.01M4.5 18.5h.01" /></>,
    staff: <><circle cx="9" cy="8" r="2.4" /><circle cx="16" cy="9" r="2" /><path d="M4.8 18.2c.6-2.4 2.4-3.7 4.2-3.7s3.6 1.3 4.2 3.7M14 14.6c1.3-.3 2.6.2 3.4 1.6.6 1 .9 1.8.9 2" /></>,
    reports: <><path d="M5 19.5V10M10 19.5V5.5M15 19.5v-6M20 19.5V8" /></>,
    lock: <><rect x="6" y="11" width="12" height="8" rx="1.5" /><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="M7 10l5 5 5-5" />,
    logout: <><path d="M10 5.5H6.5A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5H10" /><path d="M13 8.5 16.5 12 13 15.5M9 12h7.2" /></>,
    collapse: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M14 5v14M10 10l2 2-2 2" /></>,
    expand: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M10 5v14M14 10l-2 2 2 2" /></>,
    sim: <><path d="M7 3.5h6.2L19 9.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7z" /><path d="M9 13.5h6v6H9z" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
