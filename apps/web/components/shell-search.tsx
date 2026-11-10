'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { accountLabel } from './account-name';
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
      const lines = await api.officeLines({ q: needle });
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

  return (
    <div className={open ? 'shell-search is-open' : 'shell-search'} ref={box}>
      <button
        type="button"
        className="shell-search-toggle"
        aria-expanded={open}
        aria-label={t.searchPlaceholder}
        onClick={() => setOpen((value) => !value)}
      >
        <SearchIcon />
      </button>
      <form className="shell-search-desk" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="shell-search-field">
          <SearchIcon />
          <input
            ref={field}
            type="search"
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
              className="shell-search-clear"
              aria-label={t.clearFilters}
              onClick={() => {
                setQuery('');
                field.current?.focus();
              }}
            >
              <ClearIcon />
            </button>
          ) : (
            <kbd dir="ltr">Ctrl K</kbd>
          )}
        </div>
        {showResults && (
          <div className="shell-search-results" id={resultsId}>
            {shown.length === 0 ? <p className="shell-search-empty">{t.searchEmpty}</p> : groups.map((group) => (
              <div key={group}>
                <p className="shell-search-label">{group}</p>
                {shown.filter((hit) => hit.group === group).map((hit) => (
                  <Link key={hit.key} href={hit.href} className="shell-search-item" onClick={() => setOpen(false)}>
                    <strong>{hit.label}</strong>
                    {hit.sub && <small>{hit.sub}</small>}
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
