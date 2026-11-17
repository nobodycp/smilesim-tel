'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { accountLabel } from './account-name';
import { cn } from '../lib/cn';
import { api } from '../lib/api';
import { everyAccount } from '../lib/directory';
import { usePrefs } from '../lib/prefs';
import { sharedKeys } from '../lib/query';
import { useApiQuery } from '../lib/use-api-query';

type Hit = { key: string; href: string; label: string; sub: string; group: string };

/**
 * «ابحث أو انتقل» (Graphite command box): pages from the sidebar by name, then accounts and numbers. Opens with «/»,
 * Ctrl K or ⌘K.
 */
export function ShellSearch({ pages = [] }: { pages?: { href: string; label: string }[] }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const resultsId = useId();
  // Leaving the search (closed, or under two letters) drops the last hits, so coming back starts empty. Done while
  // rendering, the way React adjusts state to a change of its inputs, instead of in an effect.
  const searching = open && query.trim().length >= 2;
  const [wasSearching, setWasSearching] = useState(searching);
  if (searching !== wasSearching) {
    setWasSearching(searching);
    if (!searching) setHits([]);
  }
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The accounts are read once, when the box first opens, from the same cache entry as the users page; each
  // keystroke filters them here. Numbers are searched on the server, which matches number and serial.
  const accounts = useApiQuery(sharedKeys.users, everyAccount, { enabled: open });
  const users = accounts.data?.users;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
        field.current?.focus();
        return;
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
        field.current?.focus();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  useEffect(() => {
    const needle = query.trim();
    if (!open || needle.length < 2) return;
    let stop = false;
    const timer = window.setTimeout(async () => {
      // Only the first page of numbers is read: the box shows at most 8 hits, so `nextCursor` is ignored on purpose.
      const lines = await api.lines({ q: needle });
      if (stop) return;
      const next: Hit[] = [];
      if (users) {
        for (const row of users) {
          const login = row.loginName.toLowerCase();
          if (!row.nickname.includes(needle) && !login.includes(needle.toLowerCase())) continue;
          next.push({
            key: `user-${row.loginName}`,
            href: `/users?q=${encodeURIComponent(needle)}`,
            label: accountLabel(row.loginName, row.nickname),
            sub: '',
            group: t.navUsers,
          });
        }
      }
      if (lines.ok) {
        for (const row of lines.data.items) {
          next.push({
            key: `line-${row.id}`,
            href: `/numbers/${row.id}`,
            label: row.msisdn,
            sub: [row.companyName, row.packageName].filter(Boolean).join(' · '),
            group: t.navNumbers,
          });
        }
      }
      setHits(next.slice(0, 8));
    }, 180);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [open, query, users, t.navNumbers, t.navUsers]);

  // Pages match from the first letter, by their sidebar name; they come before accounts and numbers.
  const needle = query.trim();
  const pageHits: Hit[] = needle
    ? pages
        .filter((page) => page.label.includes(needle) || page.label.toLowerCase().includes(needle.toLowerCase()))
        .slice(0, 5)
        .map((page) => ({ key: `page-${page.href}`, href: page.href, label: page.label, sub: '', group: t.searchPages }))
    : [];
  const shown = [...pageHits, ...(needle.length >= 2 ? hits : [])];
  const groups = [...new Set(shown.map((hit) => hit.group))];
  const showResults = open && needle.length >= 1 && (pageHits.length > 0 || needle.length >= 2);

  // The look: a fixed width beside the
  // wallet chip (200px, 260px from 1200px wide) so it never jumps while the window is resized. Once the topbar is
  // 720px wide or less, or the screen is under 768px, the field becomes the icon, which opens it in a panel under
  // the box; under 768px that panel is a sheet under the whole topbar, 8px from each screen edge (the box stops being
  // positioned, so the topbar holds it), ending 8px above the screen's bottom with its results scrolling inside.
  return (
    <div className="relative flex-none max-md:static max-md:w-auto md:w-50 min-[1200px]:w-65" data-testid="shell-search" ref={box}>
      <button
        type="button"
        className={cn(
          'hidden size-11 min-w-11 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-2 hover:bg-surface-3',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink max-md:inline-flex md:size-9 md:min-w-9',
          '@max-[721px]/topbar:inline-flex [&_svg]:size-4 [&_svg]:flex-none',
        )}
        data-testid="search-toggle"
        aria-expanded={open}
        aria-label={t.searchPlaceholder}
        onClick={() => setOpen((value) => !value)}
      >
        <SearchIcon />
      </button>
      <form
        className={cn(
          'relative grid w-full gap-3.5',
          !open && 'max-md:hidden @max-[721px]/topbar:hidden',
          open && [
            'md:@max-[721px]/topbar:absolute md:@max-[721px]/topbar:end-0 md:@max-[721px]/topbar:top-pop',
            'md:@max-[721px]/topbar:z-overlay md:@max-[721px]/topbar:block md:@max-[721px]/topbar:w-[min(18rem,72vw)]',
            'md:@max-[721px]/topbar:rounded-sm md:@max-[721px]/topbar:border md:@max-[721px]/topbar:border-solid',
            'md:@max-[721px]/topbar:border-line md:@max-[721px]/topbar:bg-surface md:@max-[721px]/topbar:p-2',
            'md:@max-[721px]/topbar:shadow-pop',
            'max-md:absolute max-md:inset-x-2 max-md:top-pop max-md:z-overlay max-md:flex max-md:w-auto',
            'max-md:max-h-[calc(100dvh_-_100%_-_6px_-_var(--rd-space-2))] max-md:max-w-none max-md:flex-col max-md:gap-0',
            'max-md:rounded-sm max-md:border max-md:border-solid max-md:border-line max-md:bg-surface max-md:p-2 max-md:shadow-pop',
          ],
        )}
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <div
          className={cn(
            'flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-sm border-0 bg-sunken ps-3 pe-2 inset-ring inset-ring-line',
            'hover:not-focus-within:inset-ring-line-strong focus-within:inset-ring-accent max-md:flex-none md:h-9',
            '[&_svg]:size-4 [&_svg]:flex-none [&_svg]:text-muted',
          )}
          data-testid="search-field"
        >
          <SearchIcon />
          <input
            ref={field}
            type="search"
            className={cn(
              'h-5.5 w-0 min-w-0 flex-[1_1_0] rounded-none border-0 bg-transparent p-0 text-md text-ink shadow-none',
              'placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap focus:outline-none',
            )}
            value={query}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            aria-controls={showResults ? resultsId : undefined}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          />
          {query ? (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-pill border-0 bg-transparent p-0 text-faint hover:bg-surface-3 hover:text-ink"
              aria-label={t.clearFilters}
              onClick={() => {
                setQuery('');
                field.current?.focus();
              }}
            >
              <ClearIcon />
            </button>
          ) : (
            // The keyboard hint shows on the wide search only (1200px and up).
            <kbd
              className="hidden min-w-5.75 flex-none whitespace-nowrap rounded-xs border-0 bg-transparent px-1.5 py-0.5 text-xs font-bold leading-1-2 text-muted [font-family:inherit] inset-ring inset-ring-line-strong min-[1200px]:inline-block"
              dir="ltr"
            >
              Ctrl K
            </kbd>
          )}
        </div>
        {showResults && (
          <div
            className={cn(
              'absolute end-0 top-pop z-overlay grid max-h-[min(420px,60vh)] w-[max(100%,16rem)] gap-0.5 overflow-auto',
              'rounded-sm border border-solid border-line bg-surface p-1.5 shadow-pop',
              'max-md:static max-md:mt-1.5 max-md:min-h-0 max-md:w-full max-md:border-0 max-md:shadow-none',
              '@max-[721px]/topbar:static @max-[721px]/topbar:mt-1.5 @max-[721px]/topbar:w-full @max-[721px]/topbar:border-0',
              '@max-[721px]/topbar:shadow-none',
            )}
            id={resultsId}
          >
            {shown.length === 0 ? <p className="m-0 p-3.25 text-center text-block text-muted">{t.searchEmpty}</p> : groups.map((group) => (
              <div key={group}>
                <p className="m-0 px-2 pt-1.5 pb-0.5 text-xs font-bold text-muted">{group}</p>
                {shown.filter((hit) => hit.group === group).map((hit) => (
                  <Link
                    key={hit.key}
                    href={hit.href}
                    className="grid gap-px rounded-sm px-2 py-1.5 hover:bg-surface-hover"
                    data-testid="search-item"
                    onClick={() => setOpen(false)}
                  >
                    <strong>{hit.label}</strong>
                    {hit.sub && <small className="text-muted">{hit.sub}</small>}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
