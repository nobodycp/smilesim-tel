'use client';

import { Home } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useCrumbNames } from '../lib/crumbs';
import { usePageTitleValue } from '../lib/page-title';
import { usePrefs } from '../lib/prefs';

/** A sidebar page and the plain labels above it: the sidebar section's title, then a folding group's label. */
export type PathSection = { href: string; label: string; above: string[] };

type Part = { label: string; href?: string };

/**
 * The path in the topbar, like a folder path (spec 2026-11-09-graphite-identity, Shell): ⌂ / section / list / item.
 * It replaces the back button and the trail that sat above detail pages. Every level but the last is a link; the
 * section titles above a list are plain text. `Alt+↑` opens the level above. A level shows the name its page
 * registered (`useCrumbs`), the page's title for the last level, or the raw segment until then. A page outside the
 * sidebar shows its title alone.
 */
export function ShellPath({ pathname, sections }: { pathname: string; sections: PathSection[] }) {
  const { t } = usePrefs();
  const names = useCrumbNames();
  const title = usePageTitleValue();
  const router = useRouter();

  const parts: Part[] = [];
  if (pathname !== '/') {
    const section = sections
      .filter((item) => item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (section) {
      section.above.filter(Boolean).forEach((label) => parts.push({ label }));
      parts.push({ label: section.label, href: section.href });
      let path = section.href;
      const rest = pathname.slice(section.href.length).split('/').filter(Boolean);
      rest.forEach((segment, index) => {
        path = `${path}/${segment}`;
        let raw = segment;
        try {
          raw = decodeURIComponent(segment);
        } catch {
          raw = segment;
        }
        parts.push({ label: names[path] || (index === rest.length - 1 && title) || raw, href: path });
      });
    } else {
      parts.push({ label: title || t.homeTitle, href: pathname });
    }
  } else {
    parts.push({ label: t.homeTitle, href: '/' });
  }
  const lastIndex = parts.length - 1;
  // The level above: the nearest part before the last that is a link, or home.
  const up = pathname === '/' ? '' : ([...parts.slice(0, lastIndex)].reverse().find((part) => part.href)?.href ?? '/');

  useEffect(() => {
    if (!up) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== 'ArrowUp') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      router.push(up);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [up, router]);

  return (
    <nav className="shell-path" aria-label={t.breadcrumb}>
      <ol>
        <li className="shell-path-root">
          {pathname === '/' ? (
            <span className="shell-path-home" aria-hidden="true"><Home size={16} strokeWidth={1.9} /></span>
          ) : (
            <Link href="/" className="shell-path-home" aria-label={t.homeTitle} title={t.homeTitle}>
              <Home size={16} strokeWidth={1.9} aria-hidden="true" />
            </Link>
          )}
        </li>
        {parts.map((part, index) => {
          const last = index === lastIndex;
          return (
            <li key={`${index}-${part.label}`} className={last ? 'shell-path-part last' : 'shell-path-part'}>
              <span className="shell-path-sep" aria-hidden="true">/</span>
              {last ? (
                <span aria-current="page"><bdi>{part.label}</bdi></span>
              ) : part.href ? (
                <Link href={part.href}><bdi>{part.label}</bdi></Link>
              ) : (
                <span className="shell-path-label"><bdi>{part.label}</bdi></span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
