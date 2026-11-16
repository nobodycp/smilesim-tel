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
import { useDesk } from '../lib/desk-session';
import { formatShekel } from '../lib/money';
import { usePrefs } from '../lib/prefs';
import { usePopover } from '../lib/use-popover';
import { cn } from '../lib/cn';
import { BrandLogo } from './brand-logo';
import { Avatar } from './ui/avatar';
import { IconButton } from './ui/icon-button';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { LanguageSwitch, ThemeToggle, topbarIcon } from './chrome';
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

/*
 * The shell's look (Tailwind migration T3.1, ADR 0022), ported from shell.css with its graphite.css, base.css and
 * responsive.css takes, in cascade order. The page frame inside it (`main.canvas`, `.canvas-inner.wide`) stays on
 * desk/frame.css until T3.3: many sheets and primitives still read `.canvas` as their context.
 */

// The crimson thread at the start of the current page (and of a folded group that holds it).
const THREAD = "before:absolute before:inset-y-2.75 before:start-0 before:w-0.5 before:rounded-2xs before:bg-accent before:content-['']";

/**
 * A sidebar or drawer line (legacy `.nav-link`): 40px, 12px at the sides, 12px between the 19px icon and the name,
 * muted 13.5px semibold; under the pointer the raised fill and ink. `active`: ink on the raised fill with the thread,
 * the icon crimson; `holds` (a group head over the current page): ink, the icon crimson, the thread on the rail;
 * `nested`: 34px, 22px in, 13px medium, no thread; in the drawer 46px and 14.5px (nested 40px).
 */
function navLinkClass({
  active = false,
  holds = false,
  nested = false,
  drawer = false,
  rail = false,
  logout = false,
}: { active?: boolean; holds?: boolean; nested?: boolean; drawer?: boolean; rail?: boolean; logout?: boolean }) {
  return cn(
    'relative flex h-10 w-full items-center gap-3 overflow-hidden rounded-sm border-0 bg-transparent px-3 py-0',
    'text-start text-[13.5px] font-semibold text-muted [transition:background-color_140ms_ease,color_140ms_ease]',
    'hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
    '[&>svg]:size-4.75 [&>svg]:flex-none',
    nested && 'h-8.5 overflow-visible ps-5.5 text-md font-medium',
    drawer && (nested ? 'h-10 text-[14.5px]' : 'h-11.5 text-[14.5px]'),
    active && 'text-ink',
    active && !nested && cn('bg-surface-2', THREAD),
    (active || holds) && '[&>svg]:text-accent',
    holds && 'text-ink',
    holds && rail && THREAD,
    logout && 'hover:text-danger',
  );
}

/** A name in the sidebar (legacy `.label`): one line; on the folded rail it fades and slides 8px towards the end. */
function labelClass(rail: boolean, sidebar: boolean) {
  return cn(
    'whitespace-nowrap',
    sidebar && 'motion-safe:[transition:opacity_180ms_ease,translate_260ms_cubic-bezier(0.32,0.72,0,1)]',
    rail && 'pointer-events-none translate-x-2 opacity-0 rtl:-translate-x-2',
  );
}

type NavItem = { label: string; href: string; icon: LucideIcon; layers?: readonly string[]; grant?: string; owner?: boolean; count?: number };
// A collapsible run of items under one head (the Admin section's "Settings"). It opens when one
// of its items is the page, or when clicked; the collapsed rail shows its items as plain icons.
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] };
type NavEntry = NavItem | NavGroup;
const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = usePrefs();
  const branding = useBranding();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: noticeOpen, close: closeNotices, toggle: toggleNotices, root: noticeRoot, trigger: noticeTrigger } = usePopover();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<{ top: number; label: string; items?: NavItem[] } | null>(null);
  const { ready, failed, retrying, retry, me, initialName, initialBalance } = useDesk();
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

  // The drawer is a Sheet (components/ui/sheet.tsx, Radix Dialog): Escape, a press on the scrim, the page's scroll
  // lock and the focus are its own.
  // From 900px the drawer is hidden (lg:hidden), but an open modal Dialog would keep the page's pointer and scroll
  // lock: a window that grows past 900px while the drawer is open (a rotated tablet, a resized desktop) closes it.
  // The drawer opens only from the menu button, which shows under 900px, so the effect waits for the change.
  useEffect(() => {
    if (!mobileOpen) return;
    const wide = window.matchMedia('(min-width: 900px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
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
      if (target?.closest('[data-slot="side-flyout"], [data-slot="sidebar"]')) return;
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
  const board = useApiQuery(sharedKeys.home, () => api.home(), { enabled: ready });
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
  const deskGroups: { title: string; items: NavEntry[] }[] = [
    {
      title: '',
      items: [
        { label: t.homeTitle, href: '/', icon: Home },
        { label: t.navTasks, href: '/tasks', icon: ClipboardList, count: openTasks },
        { label: t.navNotices, href: '/notices', icon: Bell },
      ],
    },
    {
      title: t.navDesk,
      items: [
        { label: t.navNumbers, href: '/numbers', icon: Phone },
        { label: t.navUsers, href: '/users', icon: Users, layers: desk },
        reportsGroup,
      ],
    },
    {
      title: t.navOps,
      items: [
        // The branch reaches packages through their company, the catalog's root (spec 2026-11-09-admin-review, 4);
        // the agents keep their own «الرزم» catalog.
        { label: t.navPlans, href: '/packages', icon: Package, layers: ['main_agent', 'agent'] },
        { label: t.navCompanies, href: '/companies', icon: Layers, layers: ['branch'] },
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
          ],
        },
      ],
    },
  ];
  const groups: { title: string; items: NavEntry[] }[] = layer === 'pos' ? posGroups : deskGroups;
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
    const rail = collapsed && !mobile;
    const ItemIcon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={navLinkClass({ active, nested, drawer: mobile })}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          setMobileOpen(false);
          setFlyout(null);
        }}
        onMouseEnter={mobile || nested ? undefined : (event) => hint(event, item.label)}
        onFocus={mobile || nested ? undefined : (event) => hint(event, item.label)}
        onBlur={() => setFlyout(null)}
      >
        {nested ? (
          // A small diamond on the group's hairline; the current page's glows crimson.
          <span
            className={cn(
              'absolute -start-[2.5px] size-1.75 rotate-45 rounded-[2px] bg-bg inset-ring-[1.5px] inset-ring-faint',
              active && 'bg-accent inset-ring-0 shadow-[0_0_8px_var(--rd-accent)]',
            )}
            aria-hidden="true"
          />
        ) : (
          <ItemIcon {...glyph} />
        )}
        <span className={cn(labelClass(rail, !mobile), nested && active && 'text-accent')}>{item.label}</span>
        {item.count ? (
          // The open tasks: a small crimson square at the line's end; on the folded rail, a corner mark.
          <span
            className={cn(
              'ms-auto grid h-5 min-w-5 place-items-center rounded-xs bg-accent-fill px-1.5 text-xs font-bold text-on-accent',
              rail && 'absolute end-2 top-1.25 h-4 min-w-4 px-1 text-2xs',
            )}
            aria-label={`${item.count}`}
          >
            {item.count > 99 ? '99+' : item.count}
          </span>
        ) : null}
      </Link>
    );
  };

  const sidebar = (mobile: boolean) => {
    const rail = collapsed && !mobile;
    const name = <p className="m-0 text-lg font-bold leading-[1.35] text-ink">{branding.name}</p>;
    return (
      <>
        {/* Brand row: the saved logo or the cut-corner tile, the name and the door. */}
        <div className="mb-2 flex h-12 items-center gap-2.75 overflow-hidden whitespace-nowrap px-2.25">
          {branding.logo ? (
            <BrandLogo className={cn('max-h-8.5 max-w-30 flex-none', rail && 'max-w-8.5')} />
          ) : (
            <div
              className={cn(
                'grid size-8.5 flex-none place-items-center rounded-sm bg-accent-fill text-primary-fg shadow-card',
                '[clip-path:polygon(0_0,calc(100%_-_9px)_0,100%_9px,100%_100%,0_100%)]',
                'rtl:[clip-path:polygon(9px_0,100%_0,100%_100%,0_100%,0_9px)] [&>svg]:size-4.5 [&>svg]:stroke-on-accent',
              )}
              aria-hidden="true"
            >
              <Wifi {...glyph} />
            </div>
          )}
          <div className={cn('min-w-0', labelClass(rail, !mobile))}>
            {/* The drawer is a dialog; the office's name is its title. */}
            {mobile ? <SheetTitle asChild>{name}</SheetTitle> : name}
            <p className="m-0 text-xs leading-[1.35] text-muted">{role ? `${t[door.label]} · ${role}` : t[door.label]}</p>
          </div>
          {mobile && (
            <IconButton className="ms-auto" onClick={() => setMobileOpen(false)} aria-label={t.closeMenu}>
              <X {...glyph} />
            </IconButton>
          )}
        </div>
        {!mobile && (
          // The round handle on the sidebar's edge (Graphite): shows on hover or keyboard focus, folds the sidebar to
          // a rail of icons; «[» too. The hover is a plain :hover, not group-hover (which Tailwind wraps in
          // @media (hover: hover)), so a tap on a touch-only wide screen reveals it as the legacy .sidebar:hover did.
          <button
            type="button"
            className={cn(
              'absolute -end-3.25 top-18.5 z-2 grid size-6.5 place-items-center rounded-pill border-0 bg-surface-2 p-0',
              'text-ink-2 opacity-0 shadow-pop ring-1 ring-line [transition:opacity_160ms_ease,color_140ms_ease]',
              'hover:text-accent focus-visible:opacity-100 [[data-slot=sidebar]:hover_&]:opacity-100',
            )}
            onClick={toggleCollapsed}
            title={`${collapsed ? t.expand : t.collapse}  [`}
            aria-label={collapsed ? t.expand : t.collapse}
            aria-expanded={!collapsed}
          >
            <ChevronLeft
              {...glyph}
              className={cn('size-3.75 [transition:rotate_320ms_cubic-bezier(0.32,0.72,0,1)]', !collapsed && 'rotate-180')}
            />
          </button>
        )}
        <nav className="-mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 [scrollbar-width:thin]" aria-label={t.mainNav}>
          {visibleGroups.map((group) => (
            <div key={group.title || 'home'} className="mb-1.5">
              {group.title && (
                // A section's title; on the folded rail a hairline.
                <p
                  className={cn(
                    'mx-0 mt-2.5 mb-0.5 flex h-6.5 items-center overflow-hidden px-3 text-xs font-bold tracking-[0.03em] text-faint',
                    rail && "my-1.5 h-3.5 after:mx-1.5 after:h-px after:flex-1 after:bg-line after:content-['']",
                  )}
                >
                  <span className={labelClass(rail, !mobile)}>{group.title}</span>
                </p>
              )}
              {group.items.map((entry) => {
                if (!isGroup(entry)) return navLink(entry, mobile);
                const holds = entry.items.some((item) => isActive(item.href));
                const open = !rail && (openGroups[entry.key] ?? holds);
                const HeadIcon = entry.icon;
                const bodyId = `nav-group-${entry.key}${mobile ? '-drawer' : ''}`;
                return (
                  <div key={entry.key}>
                    {rail ? (
                      // Folded: the head never leaves the page; hovering or pressing it opens its pages as a flyout menu
                      // beside the rail (Graphite).
                      <button
                        type="button"
                        className={navLinkClass({ holds, rail: true })}
                        aria-label={entry.label}
                        aria-haspopup="menu"
                        aria-expanded={flyout?.label === entry.label}
                        onMouseEnter={(event) => hint(event, entry.label, entry.items)}
                        onClick={(event) => hint(event, entry.label, entry.items)}
                      >
                        <HeadIcon {...glyph} />
                        <span className={labelClass(rail, !mobile)}>{entry.label}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={navLinkClass({ holds, drawer: mobile })}
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => setOpenGroups((current) => ({ ...current, [entry.key]: !open }))}
                      >
                        <HeadIcon {...glyph} />
                        <span className={labelClass(rail, !mobile)}>{entry.label}</span>
                        <ChevronDown
                          {...glyph}
                          className={cn('ms-auto size-3.75! [transition:rotate_260ms_cubic-bezier(0.32,0.72,0,1)]', open && 'rotate-180')}
                        />
                      </button>
                    )}
                    {open && (
                      // The group's pages hang from a hairline, each with a small diamond.
                      <div
                        id={bodyId}
                        className={cn(
                          'relative grid gap-px ps-5',
                          "before:absolute before:inset-y-1.5 before:start-5.25 before:w-px before:bg-line before:content-['']",
                          'motion-safe:animate-[side-open_260ms_cubic-bezier(0.32,0.72,0,1)]',
                        )}
                      >
                        {entry.items.map((item) => navLink(item, mobile, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-1.5 grid gap-0.5 border-t border-solid border-line pt-2.5">
          {/* Language and theme live in the topbar at every width (spec 2026-11-09-admin-review, 7). */}
          {/* The account at the foot of the sidebar (Graphite): opens the profile; signing out sits under it. */}
          <Link
            href="/settings"
            className={cn(
              'flex h-12.5 items-center gap-2.75 overflow-hidden rounded-md px-1.5 text-start hover:bg-surface-2',
              rail && 'px-2',
            )}
            data-testid="side-user"
            onClick={() => setMobileOpen(false)}
            onMouseEnter={mobile ? undefined : (event) => hint(event, `${shown} · ${t.accountSettings}`)}
            onBlur={() => setFlyout(null)}
          >
            <Avatar>{initial}</Avatar>
            <span className={cn('min-w-0', labelClass(rail, !mobile))}>
              <b className="block overflow-hidden text-ellipsis text-md text-ink"><bdi>{shown}</bdi></b>
              <small className="block text-xs text-muted">{role || ' '}</small>
            </span>
          </Link>
          <button
            type="button"
            className={navLinkClass({ drawer: mobile, logout: true })}
            onClick={logout}
            onMouseEnter={mobile ? undefined : (event) => hint(event, t.logout)}
            onBlur={() => setFlyout(null)}
          >
            <LogOut {...glyph} />
            <span className={labelClass(rail, !mobile)}>{t.logout}</span>
          </button>
        </div>
      </>
    );
  };

  return (
    <>
    <title>{tabTitle(pageTitle, branding.name, unread)}</title>
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Sidebar (Graphite): the canvas colour, a hairline at its edge; folded on a wide screen it is a 76px rail whose
          names fade and come back as flyouts beside the icons. Under 900px the drawer takes its place. */}
      <aside
        className={cn(
          'relative z-[calc(var(--rd-z-topbar)_+_1)] flex w-67 min-w-0 flex-none flex-col',
          'border-e border-solid border-line bg-bg px-3 pt-3.5 pb-3 max-lg:hidden',
          'motion-safe:[transition:width_320ms_cubic-bezier(0.32,0.72,0,1)]',
          collapsed && 'w-19',
        )}
        data-testid="sidebar"
        data-slot="sidebar"
        data-collapsed={collapsed ? '' : undefined}
        onMouseLeave={() => setFlyout(null)}
      >
        {sidebar(false)}
      </aside>
      {flyout && collapsed ? (
        // Beside a hovered rail icon: its name, or a group's pages as a small menu.
        <div
          data-slot="side-flyout"
          className={cn(
            'pointer-events-none fixed start-21.5 z-dialog w-max max-w-70 whitespace-nowrap rounded-sm bg-surface-2 px-3 py-1.75',
            'text-[12.5px] font-semibold text-ink shadow-pop inset-ring inset-ring-line [transform:translateY(-50%)]',
            'motion-safe:animate-[side-flyin_160ms_cubic-bezier(0.32,0.72,0,1)] motion-safe:rtl:[animation-name:side-flyin-rtl]',
            // A menu: a bridge over the gap at its start, so the pointer can travel from the icon into it.
            flyout.items &&
              "pointer-events-auto grid min-w-47.5 gap-px p-1.5 [transform:translateY(-22px)] before:absolute before:inset-y-0 before:-start-3 before:w-3 before:content-['']",
          )}
          style={{ top: flyout.top }}
          role={flyout.items ? 'menu' : 'tooltip'}
          onMouseEnter={() => setFlyout(flyout)}
          onMouseLeave={() => setFlyout(null)}
        >
          <b className={cn('font-semibold', flyout.items && 'px-2.5 py-1.5 text-[11.5px] text-muted')}>{flyout.label}</b>
          {flyout.items?.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className={cn(
                'flex h-8.5 items-center rounded-xs px-2.5 text-md font-semibold text-ink-2 hover:bg-surface hover:text-ink',
                isActive(item.href) && 'text-accent hover:text-accent',
              )}
              aria-current={isActive(item.href) ? 'page' : undefined}
              onClick={() => setFlyout(null)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      {/* Under 900px the sidebar is this drawer at the reading start, a Sheet (Radix Dialog): mounted only while open,
          so a closed drawer takes neither the keyboard nor the accessibility tree. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" data-testid="drawer" aria-describedby={undefined} className="lg:hidden" overlayClassName="lg:hidden">
          {sidebar(true)}
        </SheetContent>
      </Sheet>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The topbar (Graphite): the path, then «ابحث أو انتقل», the wallet chip, the notices, the theme and the
            language, over a crimson hairline. Under 900px the path takes its own row under the icons. */}
        <header
          className={cn(
            'sticky top-0 z-topbar flex min-h-16 items-center justify-between gap-3 border-b border-solid border-line',
            'bg-bg/88 py-[0.6rem] backdrop-blur-[14px] backdrop-saturate-160 @container/topbar max-md:gap-1.5 max-md:px-4 md:px-7',
            'max-lg:flex-wrap max-lg:gap-y-1.5 max-lg:py-2',
            "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-accent after:opacity-35 after:content-['']",
          )}
          data-testid="topbar"
        >
          <div
            className="flex min-w-0 flex-[1_1_auto] items-center gap-[0.65rem] max-md:flex-none max-md:gap-1.5 max-lg:contents"
            data-testid="topbar-start"
          >
            <button type="button" className={cn(topbarIcon, 'hidden max-lg:inline-flex')} data-testid="menu-btn" onClick={() => setMobileOpen(true)} aria-label={t.openMenu}>
              <Menu {...glyph} />
            </button>
            <ShellPath pathname={pathname} sections={sections} />
          </div>
          <div className="flex flex-none items-center justify-end gap-2 max-md:gap-1 max-lg:ms-auto" data-testid="topbar-tools">
            <ShellSearch pages={sections.map((item) => ({ href: item.href, label: item.label }))} />
            {/* «المحفظة» (spec 2026-11-09, 4): the balance chip opens the wallet page, where top-up will live. The branch
                has no wallet: its balance is unlimited (spec 2026-11-09-admin-review, 7). Under 768px only the mark. */}
            {layer === 'branch' ? null : <div className="relative flex-none" data-testid="wallet-chip">
              <Link
                href="/wallet"
                className={cn(
                  'inline-flex size-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-0 bg-surface-2 px-3',
                  'font-bold text-ink inset-ring inset-ring-line hover:bg-surface-3',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink md:h-9 md:w-auto md:min-w-10',
                  '[&_svg]:size-3.75 [&_svg]:text-accent',
                )}
                aria-label={t.walletPage}
              >
                <Wallet {...glyph} />
                {shownBalance !== null && (
                  <span className="tabular-nums text-ink max-md:hidden" data-testid="wallet-balance" dir="ltr">
                    {formatShekel(shownBalance)}
                  </span>
                )}
                <span className="hidden">{t.walletPage}</span>
              </Link>
            </div>}
            {/* Then, in reading order, the notices, the theme and the language — the language at the very end of the bar
                (the left in Arabic and Hebrew, the right in English; spec 2026-11-09-admin-review, 7 as corrected in 8.6).
                Under 768px the notices open as a sheet under the whole topbar, 8px from each screen edge. */}
            <div className="relative max-md:static" ref={noticeRoot}>
              <button
                ref={noticeTrigger}
                type="button"
                className={cn(
                  topbarIcon,
                  'relative',
                  // Unread notices: the bell swings now and then.
                  unread > 0 && '[&_svg]:origin-[50%_4px] motion-safe:[&_svg]:animate-[shell-bell_2.4s_ease-in-out_infinite]',
                )}
                data-testid="notice-btn"
                aria-label={t.notices}
                aria-expanded={noticeOpen}
                onClick={toggleNotices}
              >
                <Bell {...glyph} />
                {unread > 0 && (
                  // A glowing crimson dot; the count is there for screen readers (font size 0).
                  <span className="absolute end-1.75 top-1.75 size-2 min-w-0 overflow-hidden rounded-pill bg-accent p-0 text-center text-[0px] font-bold leading-0 text-on-mark shadow-[0_0_8px_var(--rd-accent)] ring-2 ring-bg">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {noticeOpen && (
                <div
                  className={cn(
                    'absolute end-0 top-[calc(100%_+_0.6rem)] z-popover max-h-120 w-[min(22rem,80vw)] min-w-64 overflow-auto',
                    'rounded-lg border border-solid border-panel-line bg-surface p-[0.45rem] shadow-pop',
                    'max-md:inset-x-2 max-md:w-auto max-md:max-w-none',
                    'max-md:max-h-[min(480px,calc(100dvh_-_100%_-_0.6rem_-_var(--rd-space-2)))]',
                  )}
                  data-testid="notice-panel"
                  role="menu"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="m-0 px-[0.6rem] pt-[0.35rem] pb-2 font-bold">{t.notices}</p>
                    {unread > 0 && (
                      <button
                        type="button"
                        className="flex-none cursor-pointer rounded-pill border-0 bg-transparent px-[0.6rem] py-1 text-[0.78rem] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                        onClick={() => void markRead()}
                      >
                        {t.markAllRead}
                      </button>
                    )}
                  </div>
                  {notices.length === 0 ? (
                    <p className="mx-0 mt-1 mb-0 rounded-card bg-surface-2 p-[0.7rem] text-[0.85rem] text-muted">{t.noNotices}</p>
                  ) : notices.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 rounded-card border-0 bg-transparent',
                        'px-[0.7rem] py-[0.55rem] text-start text-[0.9rem] font-medium hover:bg-surface-hover',
                      )}
                      data-testid="notice-item"
                      onClick={() => void openNotice(row)}
                    >
                      <strong
                        className={cn(
                          'min-w-0 truncate',
                          // Unread: a crimson dot before the title.
                          !row.read &&
                            "before:me-[0.4rem] before:inline-block before:size-1.5 before:rounded-pill before:bg-accent before:align-middle before:content-['']",
                        )}
                      >
                        {noticeTitle(t, row)}
                      </strong>
                      <small className="whitespace-nowrap text-[0.72rem] tabular-nums text-muted">{noticeAge(t, row.createdAt)}</small>
                      <small className="col-span-full truncate text-muted" data-testid="notice-detail">{noticeDetail(t, row)}</small>
                    </button>
                  ))}
                  <span className="mx-1 my-[0.35rem] block h-px bg-line" />
                  <Link
                    href="/notices"
                    className="flex w-full items-center gap-[0.6rem] rounded-card px-[0.7rem] py-[0.55rem] text-start text-[0.9rem] font-medium hover:bg-surface-hover"
                    onClick={closeNotices}
                  >
                    {t.allNotices}
                  </Link>
                </div>
              )}
            </div>
            <ThemeToggle shell />
            <LanguageSwitch topbar />
          </div>
        </header>
        <main className="canvas">
          {me && impersonating && (
            // Inside an entered account: its name and the way back, one line above the page.
            <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2 text-md font-bold text-ink">
              <span>{shown}</span>
              <button
                type="button"
                className="h-7.5 cursor-pointer rounded-sm border-0 bg-accent-fill px-3 py-0 text-sm font-bold text-on-accent hover:bg-accent-fill-hover max-[721px]:min-h-11"
                onClick={leaveAccount}
              >
                {t.returnAccount}
              </button>
            </div>
          )}
          {ready && !reachable && <OutageBar />}
          <div className="canvas-inner wide" data-testid="canvas-inner">
            {/* The page mounts at once so its loads run beside `/v1/me`; `Desk` draws the
                skeleton until the session answers. Only an API that is down replaces it. */}
            {failed ? <OutagePanel onRetry={retry} busy={retrying} /> : children}
          </div>
        </main>
      </div>
      {fresh && (
        // Live arrival: one card at the top corner, 4s, then it leaves. Click opens the record.
        <div
          className={cn(
            'fixed end-4 top-18 z-shell-toast flex w-[min(22rem,calc(100vw_-_2rem))] items-stretch rounded-lg',
            'border border-s-3 border-solid border-panel-line border-s-accent bg-surface shadow-pop',
            'motion-safe:animate-[notice-toast-in_240ms_var(--rd-ease-out)]',
          )}
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-[0.65rem] border-0 bg-transparent px-[0.85rem] py-[0.7rem] text-start"
            onClick={() => void openNotice(fresh)}
          >
            <Bell {...glyph} />
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-[0.9rem]">{noticeTitle(t, fresh)}</strong>
              <small className="truncate text-[0.78rem] text-muted">{noticeDetail(t, fresh)}</small>
            </span>
          </button>
          <button type="button" className="w-11 flex-none cursor-pointer border-0 bg-transparent text-muted hover:text-ink" aria-label={t.closeMenu} onClick={dismiss}>
            <X {...glyph} />
          </button>
        </div>
      )}
    </div>
    </>
  );
}
