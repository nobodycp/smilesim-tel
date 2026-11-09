'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Home,
  Layers,
  LogOut,
  Megaphone,
  Menu,
  Package,
  KeyRound,
  Palette,
  Truck,
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
import { ShellPath, type PathSection } from './crumbs';
import { OutageBar, OutagePanel } from './outage';
import { useNotices } from '../lib/use-notices';
import { tabTitle, usePageTitleValue } from '../lib/page-title';
import { noticeAge, noticeDetail, noticeTitle } from '../lib/notice-text';
import { doorUrl } from '../lib/doors';
import { reloadAt } from '../lib/reload-at';
import { sharedKeys } from '../lib/query';
import { useApiQuery } from '../lib/use-api-query';

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

const glyph = { size: 18, strokeWidth: 1.9, 'aria-hidden': true as const };

type NavItem = { label: string; href: string; icon: LucideIcon; layers?: readonly string[]; grant?: string; owner?: boolean; count?: number };
// A collapsible run of items under one head (the Admin section's "Settings"). It opens when one
// of its items is the page, or when clicked; the collapsed rail shows its items as plain icons.
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] };
type NavEntry = NavItem | NavGroup;
const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

export function OfficeShell({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const branding = useBranding();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: noticeOpen, close: closeNotices, toggle: toggleNotices, root: noticeRoot, trigger: noticeTrigger } = usePopover();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<{ top: number; label: string; items?: NavItem[] } | null>(null);
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

  // Graphite: figure, fact and action cards carry a soft light under the pointer (CSS reads --mx / --my).
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>('.figure-tile, .shortcut-tile, .stat, .fact-grid > div, .op-card, .op-tile, .line-op, .company-card, .pack-card');
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);

  // A flyout menu opened by a press closes on a press elsewhere or on Escape.
  useEffect(() => {
    if (!flyout?.items) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.side-flyout, .sidebar')) return;
      setFlyout(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFlyout(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [flyout]);

  // «[» folds or opens the sidebar, outside of text fields.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      writeCollapsed(!readCollapsed());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);


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

  // The open tasks beside «المهام» (Graphite): the home board's count, read once and kept in the shared cache.
  const board = useApiQuery(sharedKeys.home, () => api.officeHome(), { enabled: ready });
  const openTasks = board.data?.openTasks ?? 0;
  const desk = ['branch', 'main_agent', 'agent'] as const;
  // «التقارير» (spec 2026-11-08-overview-and-reports-nav, C): every report is its own page, folded in one group
  // that starts closed and opens by itself on one of its pages. Each layer sees the reports its data allows. Five
  // since spec 2026-11-09-admin-review, 1: «العمليات», «المبيعات» and «الطلبات» repeated «المالية» and «المهام».
  const reportsGroup: NavGroup = {
    key: 'reports',
    label: t.navReports,
    icon: BarChart3,
    items: [
      { label: t.navFinance, href: '/finance', icon: Wallet },
      { label: t.navProfits, href: '/profits', icon: TrendingUp },
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
        { label: t.navTasks, href: '/tasks', icon: ClipboardList, count: openTasks },
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
        { label: t.navTasks, href: '/tasks', icon: ClipboardList, count: openTasks },
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
          items: [
            { label: t.navBranding, href: '/branding', icon: Palette, layers: ['branch'], owner: true },
            // The layers' sign-in rules: a system setting, not the owner's own account (spec 2026-11-09-admin-review, 5).
            { label: t.accessRulesTitle, href: '/settings/access', icon: KeyRound, layers: ['branch'], owner: true },
          ],
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
  // The topbar path (spec 2026-11-09-graphite-identity): each sidebar page with the plain labels above it — the
  // section's title, then a folding group's label.
  const sections: PathSection[] = groups.flatMap((group) =>
    group.items.flatMap((entry) =>
      isGroup(entry)
        ? entry.items.map((item) => ({ href: item.href, label: item.label, above: [group.title, entry.label] }))
        : [{ href: entry.href, label: entry.label, above: [group.title] }],
    ),
  );
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  // The account answer wins; before it lands the saved identity, then the cookie name, fill in.
  const shown = me ? me.nickname || me.loginName : saved.account || initialName;
  const first = shown.trim().split(/\s+/)[0] || shown;
  const initial = first.charAt(0);
  const role = me?.layer === 'branch' ? t.layerBranch : me?.layer === 'main_agent' ? t.layerMain : me?.layer === 'agent' ? t.layerAgent : me?.layer === 'pos' ? t.layerPos : me?.layer === 'staff' ? t.staffAccount : '';

  // Folded on a wide screen, the rail shows each name — and a group's pages as a menu — beside the hovered icon
  // (Graphite flyout). Under 900px the sidebar is the drawer and shows its names itself.
  const hint = (event: { currentTarget: HTMLElement }, label: string, items?: NavItem[]) => {
    if (!collapsed || window.matchMedia('(max-width: 899px)').matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    setFlyout({ top: box.top + box.height / 2, label, items });
  };

  const navLink = (item: NavItem, mobile: boolean, nested = false) => {
    const active = isActive(item.href);
    const ItemIcon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={['nav-link', nested ? 'nested' : '', active ? 'active' : ''].filter(Boolean).join(' ')}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          setMobileOpen(false);
          setFlyout(null);
        }}
        onMouseEnter={mobile || nested ? undefined : (event) => hint(event, item.label)}
        onFocus={mobile || nested ? undefined : (event) => hint(event, item.label)}
        onBlur={() => setFlyout(null)}
      >
        {nested ? <span className="nav-bullet" aria-hidden="true" /> : <ItemIcon {...glyph} />}
        <span className="label">{item.label}</span>
        {item.count ? <span className="nav-count num" aria-label={`${item.count}`}>{item.count > 99 ? '99+' : item.count}</span> : null}
      </Link>
    );
  };

  const sidebar = (mobile: boolean) => {
    const rail = collapsed && !mobile;
    return (
      <>
        <div className="brand-block">
          {branding.logo ? (
            <BrandLogo className="brand-block-logo" />
          ) : (
            <div className="brand-mark" aria-hidden="true">
              <Wifi {...glyph} />
            </div>
          )}
          <div className="brand-copy label">
            <p className="brand-name">{branding.name}</p>
            <p className="brand-sub">{role ? `${t[door.label]} · ${role}` : t[door.label]}</p>
          </div>
          {mobile && (
            <button type="button" className="icon-btn drawer-close" onClick={() => setMobileOpen(false)} aria-label={t.closeMenu}>
              <X {...glyph} />
            </button>
          )}
        </div>
        {!mobile && (
          // The handle on the sidebar's edge (Graphite): shows on hover, folds the sidebar to a rail of icons; «[» too.
          <button
            type="button"
            className="side-handle"
            onClick={toggleCollapsed}
            title={`${collapsed ? t.expand : t.collapse}  [`}
            aria-label={collapsed ? t.expand : t.collapse}
            aria-expanded={!collapsed}
          >
            <ChevronLeft {...glyph} className="flip-ltr" />
          </button>
        )}
        <nav className="side-nav" aria-label={t.mainNav}>
          {visibleGroups.map((group) => (
            <div key={group.title || 'home'} className="side-section">
              {group.title && <p className="nav-label"><span className="label">{group.title}</span></p>}
              {group.items.map((entry) => {
                if (!isGroup(entry)) return navLink(entry, mobile);
                const holds = entry.items.some((item) => isActive(item.href));
                const open = !rail && (openGroups[entry.key] ?? holds);
                const HeadIcon = entry.icon;
                const bodyId = `nav-group-${entry.key}${mobile ? '-drawer' : ''}`;
                return (
                  <div key={entry.key} className={open ? 'nav-group open' : 'nav-group'}>
                    {rail ? (
                      // Folded: the head never leaves the page; hovering or pressing it opens its pages as a flyout menu
                      // beside the rail (Graphite).
                      <button
                        type="button"
                        className={holds ? 'nav-link nav-group-head holds' : 'nav-link nav-group-head'}
                        aria-label={entry.label}
                        aria-haspopup="menu"
                        aria-expanded={flyout?.label === entry.label}
                        onMouseEnter={(event) => hint(event, entry.label, entry.items)}
                        onClick={(event) => hint(event, entry.label, entry.items)}
                      >
                        <HeadIcon {...glyph} />
                        <span className="label">{entry.label}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={holds ? 'nav-link nav-group-head holds' : 'nav-link nav-group-head'}
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => setOpenGroups((current) => ({ ...current, [entry.key]: !open }))}
                      >
                        <HeadIcon {...glyph} />
                        <span className="label">{entry.label}</span>
                        <ChevronDown {...glyph} className="nav-group-chevron" />
                      </button>
                    )}
                    {open && (
                      <div id={bodyId} className="nav-group-body">
                        {entry.items.map((item) => navLink(item, mobile, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {mobile ? (
            <div className="drawer-prefs">
              <ThemeToggle shell />
              <LanguageSwitch shell />
            </div>
          ) : null}
          {/* The account at the foot of the sidebar (Graphite): opens the profile; signing out sits under it. */}
          <Link
            href="/settings"
            className="side-user"
            onClick={() => setMobileOpen(false)}
            onMouseEnter={mobile ? undefined : (event) => hint(event, `${shown} · ${t.accountSettings}`)}
            onBlur={() => setFlyout(null)}
          >
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="label">
              <b><bdi>{shown}</bdi></b>
              <small>{role || ' '}</small>
            </span>
          </Link>
          <button
            type="button"
            className="nav-link side-logout"
            onClick={logout}
            onMouseEnter={mobile ? undefined : (event) => hint(event, t.logout)}
            onBlur={() => setFlyout(null)}
          >
            <LogOut {...glyph} />
            <span className="label">{t.logout}</span>
          </button>
        </div>
      </>
    );
  };

  return (
    <>
    <title>{tabTitle(pageTitle, branding.name, unread)}</title>
    <div className="office">
      {mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'} onMouseLeave={() => setFlyout(null)}>{sidebar(false)}</aside>
      {flyout && collapsed ? (
        <div
          className={flyout.items ? 'side-flyout is-menu' : 'side-flyout'}
          style={{ top: flyout.top }}
          role={flyout.items ? 'menu' : 'tooltip'}
          onMouseEnter={() => setFlyout(flyout)}
          onMouseLeave={() => setFlyout(null)}
        >
          <b>{flyout.label}</b>
          {flyout.items?.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={isActive(item.href) ? 'active' : undefined}
              aria-current={isActive(item.href) ? 'page' : undefined}
              onClick={() => setFlyout(null)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      {/* Closed, the drawer is off screen but still in the page: `inert` keeps it out of the tab order and the
          accessibility tree until it opens. */}
      <aside className={mobileOpen ? 'drawer open' : 'drawer'} inert={!mobileOpen}>{sidebar(true)}</aside>
      <div className="office-main">
        <header className="topbar">
          <div className="topbar-start">
            <button type="button" className="shell-icon menu-btn" onClick={() => setMobileOpen(true)} aria-label={t.openMenu}>
              <Menu {...glyph} />
            </button>
            <ShellPath pathname={pathname} sections={sections} />
          </div>
          <div className="topbar-tools">
            <ShellSearch pages={sections.map((item) => ({ href: item.href, label: item.label }))} />
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
            {/* Graphite topbar: search, wallet, notices, then the language menu beside the theme (spec
                2026-11-09-admin-review, 2b). Under 360px the language moves to the drawer's foot. */}
            <span className="topbar-prefs"><LanguageSwitch topbar /></span>
            <ThemeToggle shell />
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
