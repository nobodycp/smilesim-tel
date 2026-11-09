'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardList,
  Home,
  Layers,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Palette,
  Receipt,
  ShoppingCart,
  Truck,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Settings,
  Shield,
  Radio,
  ListChecks,
  TrendingUp,
  Users,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import { api, type NoticeRow } from '../lib/api';
import { useBranding } from '../lib/branding';
import { useConnection } from '../lib/connection';
import { forgetIdentity, useIdentity } from '../lib/identity';
import { useDoor } from '../lib/door-context';
import { useOffice } from '../lib/office-session';
import { formatShekel } from '../lib/money';
import { usePrefs } from '../lib/prefs';
import { usePopover } from '../lib/use-popover';
import { BrandLogo } from './brand-logo';
import { LanguageSwitch, ThemeToggle } from './chrome';
import { ShellSearch } from './shell-search';
import { BackLink } from './back-link';
import { Crumbs } from './crumbs';
import { OutageBar, OutagePanel } from './outage';
import { useNotices } from '../lib/use-notices';
import { tabTitle, usePageTitleValue } from '../lib/page-title';
import { noticeAge, noticeDetail, noticeTitle } from '../lib/notice-text';
import { doorUrl } from '../lib/doors';
import { reloadAt } from '../lib/reload-at';

const COLLAPSE_KEY = 'smilesim-sidebar-collapsed';

// The collapsed sidebar is a browser preference (localStorage), read through useSyncExternalStore: the server render
// draws it open, the browser answers on hydration. Storage may be off; the choice then lives for the tab only.
const collapseListeners = new Set<() => void>();
let collapseFallback = false;
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return collapseFallback;
  }
}
function writeCollapsed(next: boolean) {
  collapseFallback = next;
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  } catch {
    // Preference is optional.
  }
  collapseListeners.forEach((listener) => listener());
}
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}
const serverCollapsed = () => false;

// The greeting and the date depend on the browser's clock, so the server renders neither; one string, so the snapshot
// compares equal between reads.
const noSubscribe = () => () => {};
const glyph = { size: 18, strokeWidth: 2.2, 'aria-hidden': true as const };

type NavItem = { label: string; href: string; icon: LucideIcon; layers?: readonly string[]; grant?: string; owner?: boolean };
// A collapsible run of items under one head (the Admin section's "Settings"). It opens when one
// of its items is the page, or when clicked; the collapsed rail shows its items as plain icons.
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] };
type NavEntry = NavItem | NavGroup;
const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

export function OfficeShell({ children }: { children: ReactNode }) {
  const { t, locale } = usePrefs();
  const branding = useBranding();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: menuOpen, close: closeMenu, toggle: toggleMenu, root: menuRoot, trigger: menuTrigger } = usePopover({ menu: true });
  const { open: noticeOpen, close: closeNotices, toggle: toggleNotices, root: noticeRoot, trigger: noticeTrigger } = usePopover();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { ready, failed, retrying, retry, me, initialName, initialBalance } = useOffice();
  const { reachable } = useConnection();
  const { notices, unread, fresh, markRead, dismiss } = useNotices(ready);
  const pageTitle = usePageTitleValue();
  const door = useDoor();
  const layer = door.layer;
  const balance = me ? me.balance : null;
  const shownBalance = balance !== null ? balance : initialBalance;
  const impersonating = me?.impersonating ?? false;
  const saved = useIdentity();

  async function leaveAccount() {
    const result = await api.leaveUser();
    // The entered account was open on its own door; the owner goes back to the admin door's users page.
    if (result.ok) reloadAt(doorUrl('admin', '/users'));
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

  async function openNotice(row: NoticeRow) {
    if (!row.read) await markRead(row.id);
    closeNotices();
    dismiss();
    window.location.assign(row.href);
  }

  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }


  // Signing out revokes this session and then leaves for the sign-in page on purpose: a full load drops every
  // piece of account state held in memory. If the revoke fails (API down) the account stays signed in, as shown.
  async function logout() {
    const listed = await api.listSessions();
    if (!listed.ok) return;
    const current = listed.data.sessions.find((session) => session.current);
    if (current) {
      const revoked = await api.revokeSession(current.id);
      if (!revoked.ok) return;
    }
    forgetIdentity();
    window.location.replace('/login');
  }

  const desk = ['branch', 'main_agent', 'agent'] as const;
  // «التقارير» (spec 2026-11-08-overview-and-reports-nav, C): every report is its own page, folded in one group
  // that starts closed and opens by itself on one of its pages. Each layer sees the reports its data allows.
  const reportsGroup: NavGroup = {
    key: 'reports',
    label: t.navReports,
    icon: BarChart3,
    items: [
      { label: t.navFinance, href: '/finance', icon: Wallet },
      { label: t.navOperations, href: '/operations', icon: Package },
      { label: t.navProfits, href: '/profits', icon: TrendingUp },
      { label: t.salesTitle, href: '/reports/sales', icon: ShoppingCart },
      { label: t.ordersTitle, href: '/reports/orders', icon: Receipt },
      { label: t.balancesTitle, href: '/reports/balances', icon: Wallet, layers: desk },
      { label: t.reportProviders, href: '/reports/supply', icon: Truck, layers: ['branch'], grant: 'reports' },
      { label: t.navProviderOps, href: '/provider-operations', icon: ListChecks, layers: ['branch'], grant: 'reports' },
    ],
  };
  const posGroups: { title: string; items: NavEntry[] }[] = [
    {
      title: '',
      items: [
        { label: t.homeTitle, href: '/', icon: Home },
        { label: t.navNumbers, href: '/numbers', icon: Phone },
        { label: t.navPlans, href: '/packages', icon: Package },
        { label: t.navTasks, href: '/tasks', icon: ClipboardList },
        reportsGroup,
        { label: t.navAudit, href: '/audit', icon: ListChecks },
      ],
    },
  ];
  const officeGroups: { title: string; items: NavEntry[] }[] = [
    {
      title: '',
      items: [
        { label: t.homeTitle, href: '/', icon: Home },
        { label: t.navTasks, href: '/tasks', icon: ClipboardList },
        { label: t.navNotices, href: '/notices', icon: Bell },
      ],
    },
    {
      title: t.navOffice,
      items: [
        { label: t.navNumbers, href: '/numbers', icon: Phone },
        { label: t.navUsers, href: '/users', icon: Users, layers: desk },
        reportsGroup,
      ],
    },
    {
      title: t.navOps,
      items: [
        { label: t.navPlans, href: '/packages', icon: Package },
        { label: t.navCompanies, href: '/companies', icon: Layers, layers: ['branch'], grant: 'edit' },
        { label: t.providersTitle, href: '/providers', icon: Radio, layers: ['branch'], grant: 'edit' },
        { label: t.providerAccounts, href: '/provider-accounts', icon: Wallet, layers: ['branch'], grant: 'accounting' },
      ],
    },
    {
      title: t.navAdmin,
      items: [
        { label: t.navAudit, href: '/audit', icon: ClipboardList },
        { label: t.navRoles, href: '/roles', icon: Shield, layers: ['branch'], owner: true },
        { label: t.offersTitle, href: '/offers', icon: Megaphone, layers: ['branch'], grant: 'edit' },
        {
          key: 'settings',
          label: t.navSettings,
          icon: Settings,
          items: [{ label: t.navBranding, href: '/branding', icon: Palette, layers: ['branch'], owner: true }],
        },
      ],
    },
  ];
  const groups: { title: string; items: NavEntry[] }[] = layer === 'pos' ? posGroups : officeGroups;
  const allowed = (item: NavItem) => {
    if (item.layers && !item.layers.includes(layer)) return false;
    // The account arrives after the first paint. Dropping gated items before
    // that paints half the menu, then snaps the rest in.
    if (!ready) return true;
    if (item.owner && !me?.isBranchOwner) return false;
    if (item.grant && !me?.isBranchOwner && !me?.grants?.includes(item.grant)) return false;
    return true;
  };
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((entry) => (isGroup(entry) ? { ...entry, items: entry.items.filter(allowed) } : entry))
        .filter((entry) => (isGroup(entry) ? entry.items.length > 0 : allowed(entry))),
    }))
    .filter((group) => group.items.length > 0);
  const flatItems = (entries: NavEntry[]) => entries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));
  const roots = new Set(groups.flatMap((group) => flatItems(group.items).map((item) => item.href)));
  const backHref = roots.has(pathname) ? '' : pathname.split('/').slice(0, -1).join('/') || '/';
  // The trail names the section by its sidebar label; a page outside the sidebar keeps the back button.
  const sections = groups.flatMap((group) => flatItems(group.items)).map((item) => ({ href: item.href, label: item.label }));
  const inSection = sections.some((item) => item.href !== '/' && pathname.startsWith(`${item.href}/`));
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  const navLink = (item: NavItem, compact: boolean) => {
    const active = isActive(item.href);
    const ItemIcon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={active ? 'nav-link active' : 'nav-link'}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => setMobileOpen(false)}
      >
        <ItemIcon {...glyph} />
        {!compact && <span>{item.label}</span>}
      </Link>
    );
  };

  const sidebar = (mobile: boolean) => {
    const compact = collapsed && !mobile;
    return (
      <>
        <div className={compact ? 'brand-block compact' : 'brand-block'}>
          {mobile && (
            <button type="button" className="icon-btn drawer-close" onClick={() => setMobileOpen(false)} aria-label={t.closeMenu}>
              <X {...glyph} />
            </button>
          )}
          {branding.logo ? (
            <BrandLogo className="brand-block-logo" />
          ) : (
            <div className="brand-mark" aria-hidden="true">
              <Wifi {...glyph} size={compact ? 20 : 28} />
            </div>
          )}
          {!compact && (
            <div className="brand-copy">
              <p className="brand-name">{branding.name}</p>
              <p className="brand-sub">{t[door.label]}</p>
            </div>
          )}
          <span className="brand-rule" aria-hidden="true" />
        </div>
        <nav className="side-nav" aria-label={t.mainNav}>
          {visibleGroups.map((group) => (
            <div key={group.title || 'home'}>
              {!compact && group.title && <p className="nav-label">{group.title}</p>}
              {group.items.map((entry) => {
                if (!isGroup(entry)) return navLink(entry, compact);
                if (compact) return entry.items.map((item) => navLink(item, compact));
                const open = openGroups[entry.key] ?? entry.items.some((item) => isActive(item.href));
                const HeadIcon = entry.icon;
                const bodyId = `nav-group-${entry.key}${mobile ? '-drawer' : ''}`;
                return (
                  <div key={entry.key} className="nav-group">
                    <button
                      type="button"
                      className="nav-link nav-group-head"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => setOpenGroups((current) => ({ ...current, [entry.key]: !open }))}
                    >
                      <HeadIcon {...glyph} />
                      <span>{entry.label}</span>
                      <ChevronDown {...glyph} size={14} className={open ? 'nav-group-chevron open' : 'nav-group-chevron'} />
                    </button>
                    {open && (
                      <div id={bodyId} className="nav-group-body">
                        {entry.items.map((item) => navLink(item, compact))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {mobile && (
            <div className="drawer-prefs">
              <ThemeToggle shell />
              <LanguageSwitch shell />
            </div>
          )}
          <button
            type="button"
            className="nav-link collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? t.expand : t.collapse}
            aria-label={collapsed ? t.expand : t.collapse}
          >
            {collapsed ? (
              <PanelLeftOpen {...glyph} className="flip-ltr" />
            ) : (
              <PanelLeftClose {...glyph} className="flip-ltr" />
            )}
            {!compact && <span>{t.collapse}</span>}
          </button>
        </div>
      </>
    );
  };

  // The account answer wins; before it lands the saved identity, then the cookie name, fill in.
  const shown = me ? me.nickname || me.loginName : saved.account || initialName;
  const sub = me ? (me.nickname ? me.loginName : '') : saved.hint;
  const first = shown.trim().split(/\s+/)[0] || shown;
  const initial = first.charAt(0);
  const clockText = useSyncExternalStore(
    noSubscribe,
    () => {
      const now = new Date();
      const hello = now.getHours() < 12 ? t.goodMorning : now.getHours() < 18 ? t.goodAfternoon : t.goodEvening;
      const today = new Intl.DateTimeFormat(locale === 'en' ? 'en' : locale === 'he' ? 'he' : 'ar', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now);
      return `${hello}\n${today}`;
    },
    () => null,
  );
  const [clockHello, clockToday] = clockText ? clockText.split('\n') : [];
  const clock = clockText ? { hello: clockHello, today: clockToday } : null;
  const helloMark = locale === 'en' ? ',' : '،';
  const role = me?.layer === 'branch' ? t.layerBranch : me?.layer === 'main_agent' ? t.layerMain : me?.layer === 'agent' ? t.layerAgent : me?.layer === 'pos' ? t.layerPos : me?.layer === 'staff' ? t.staffAccount : '';

  return (
    <>
    <title>{tabTitle(pageTitle, branding.name, unread)}</title>
    <div className="office">
      {mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>{sidebar(false)}</aside>
      {/* Closed, the drawer is off screen but still in the page: `inert` keeps it out of the tab order and the
          accessibility tree until it opens. */}
      <aside className={mobileOpen ? 'drawer open' : 'drawer'} inert={!mobileOpen}>{sidebar(true)}</aside>
      <div className="office-main">
        <header className="topbar">
          <div className="topbar-start">
            <button type="button" className="shell-icon menu-btn" onClick={() => setMobileOpen(true)} aria-label={t.openMenu}>
              <Menu {...glyph} />
            </button>
            <div className="hello">
              <span className="hello-title">
                {clock ? `${clock.hello}${helloMark} ` : null}
                <bdi>{first}</bdi>
              </span>
              <span className="hello-date">{clock?.today ?? '\u00a0'}</span>
            </div>
          </div>
          <div className="topbar-tools">
            <ShellSearch />
            {/* «المحفظة» (spec 2026-11-09, 4): the balance chip opens the wallet page, where top-up will live. */}
            <div className="wallet-chip">
              <Link href="/wallet" className="wallet-btn" aria-label={t.walletPage}>
                <Wallet {...glyph} />
                {shownBalance !== null && (
                  <span className={shownBalance < 0 ? 'money neg' : shownBalance > 0 ? 'money pos' : 'money'} dir="ltr">
                    {formatShekel(shownBalance)}
                  </span>
                )}
                <span className="wallet-word">{t.walletPage}</span>
              </Link>
            </div>
            <div className="notice-wrap" ref={noticeRoot}>
              <button
                ref={noticeTrigger}
                type="button"
                className={unread > 0 ? 'shell-icon notice-btn is-active' : 'shell-icon notice-btn'}
                aria-label={t.notices}
                aria-expanded={noticeOpen}
                onClick={toggleNotices}
              >
                <Bell {...glyph} />
                {unread > 0 && <span className="notice-count">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {noticeOpen && (
                <div className="shell-panel notice-panel" role="menu">
                  <div className="notice-panel-head">
                    <p className="shell-panel-title">{t.notices}</p>
                    {unread > 0 && (
                      <button type="button" className="notice-mark-all" onClick={() => void markRead()}>
                        {t.markAllRead}
                      </button>
                    )}
                  </div>
                  {notices.length === 0 ? (
                    <p className="shell-empty">{t.noNotices}</p>
                  ) : notices.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={row.read ? 'shell-item' : 'shell-item unread'}
                      onClick={() => void openNotice(row)}
                    >
                      <strong>{noticeTitle(t, row)}</strong>
                      <small className="notice-age">{noticeAge(t, row.createdAt)}</small>
                      <small className="notice-detail">{noticeDetail(t, row)}</small>
                    </button>
                  ))}
                  <span className="shell-rule" />
                  <Link href="/notices" onClick={closeNotices}>
                    {t.allNotices}
                  </Link>
                </div>
              )}
            </div>
            {/* Below 360px seven 44px controls do not fit beside the menu button: these two move to the drawer's foot. */}
            <div className="topbar-prefs">
              <ThemeToggle shell />
              <LanguageSwitch shell />
            </div>
            <div className="user-menu" ref={menuRoot}>
              <button
                ref={menuTrigger}
                type="button"
                className="avatar-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t.userMenu}
                onClick={toggleMenu}
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
                  <Link href="/settings" role="menuitem" onClick={closeMenu}>
                    <Settings {...glyph} />
                    {t.accountSettings}
                  </Link>
                  <Link href="/wallet" role="menuitem" onClick={closeMenu}>
                    <Wallet {...glyph} />
                    {t.walletPage}
                  </Link>
                  <span className="shell-rule" />
                  <button type="button" className="danger" role="menuitem" onClick={logout}>
                    <LogOut {...glyph} />
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
              <span>{shown}</span>
              <button type="button" onClick={leaveAccount}>{t.returnAccount}</button>
            </div>
          )}
          {ready && !reachable && <OutageBar />}
          <div className="canvas-inner wide">
            {ready && backHref ? (inSection ? <Crumbs pathname={pathname} sections={sections} /> : <BackLink href={backHref} />) : null}
            {/* The page mounts at once so its loads run beside `/office/me`; `Desk` draws the
                skeleton until the session answers. Only an API that is down replaces it. */}
            {failed ? <OutagePanel onRetry={retry} busy={retrying} /> : children}
          </div>
        </main>
      </div>
      {fresh && (
        <div className="notice-toast" role="status" aria-live="polite">
          <button type="button" className="notice-toast-body" onClick={() => void openNotice(fresh)}>
            <Bell {...glyph} />
            <span>
              <strong>{noticeTitle(t, fresh)}</strong>
              <small>{noticeDetail(t, fresh)}</small>
            </span>
          </button>
          <button type="button" className="notice-toast-close" aria-label={t.closeMenu} onClick={dismiss}>
            <X {...glyph} />
          </button>
        </div>
      )}
    </div>
    </>
  );
}
