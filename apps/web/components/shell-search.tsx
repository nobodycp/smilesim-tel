'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';

type Hit = { key: string; href: string; label: string; sub: string; group: string };

export function ShellSearch() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
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
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    let stop = false;
    const timer = window.setTimeout(async () => {
      const [users, lines] = await Promise.all([api.officeUsers(), api.officeLines({ q: needle })]);
      if (stop) return;
      const next: Hit[] = [];
      if (users.ok) {
        for (const row of users.data.users) {
          const login = row.loginName.toLowerCase();
          if (!row.nickname.includes(needle) && !login.includes(needle.toLowerCase())) continue;
          next.push({
            key: `user-${row.loginName}`,
            href: `/users?q=${encodeURIComponent(needle)}`,
            label: row.nickname,
            sub: row.loginName,
            group: t.navUsers,
          });
        }
      }
      if (lines.ok) {
        for (const row of lines.data.lines) {
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
  }, [open, query, t.navNumbers, t.navUsers]);

  const groups = [...new Set(hits.map((hit) => hit.group))];

  return (
    <div className={open ? 'shell-search open' : 'shell-search'} ref={box}>
      <button
        type="button"
        className="shell-search-toggle"
        aria-expanded={open}
        aria-label={t.searchPlaceholder}
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="shell-search-placeholder">{t.searchPlaceholder}</span>
        <kbd>/</kbd>
      </button>
      {open && (
        <form className="shell-search-panel" role="search" onSubmit={(event) => event.preventDefault()}>
          <div className="shell-search-field">
            <SearchIcon />
            <input
              ref={field}
              type="search"
              value={query}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>Esc</kbd>
          </div>
          {query.trim().length >= 2 && (
            <div className="shell-search-results">
              {hits.length === 0 ? <p className="shell-search-empty">{t.searchEmpty}</p> : groups.map((group) => (
                <div key={group}>
                  <p className="shell-search-label">{group}</p>
                  {hits.filter((hit) => hit.group === group).map((hit) => (
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
      )}
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
