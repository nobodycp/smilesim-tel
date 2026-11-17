'use client';

import { Home } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '../lib/cn';
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

  // The path sits in an inset box (Graphite): section titles
  // muted, the levels above the page `--rd-ink-2` links, the page itself ink. Under 900px it takes its own row.
  const level = 'overflow-hidden text-ellipsis rounded-xs px-1.5 py-0.75 text-md';
  return (
    <nav className="min-w-0 flex-[0_1_auto] max-lg:order-10 max-lg:flex-[1_0_100%]" aria-label={t.breadcrumb}>
      <ol className="m-0 flex h-8.5 list-none items-center gap-0.5 overflow-hidden whitespace-nowrap rounded-sm bg-sunken py-0 ps-1 pe-2.5 inset-ring inset-ring-line">
        <li className="inline-flex min-w-0 items-center gap-0.5">
          {pathname === '/' ? (
            <span className="grid size-7.5 place-items-center rounded-sm text-muted [&_svg]:size-4" aria-hidden="true"><Home size={16} strokeWidth={1.9} /></span>
          ) : (
            <Link
              href="/"
              className={cn(
                // The home link takes the level's padding, 4px corner and ink-2 at weight 500; only the span on «/» is muted with a 6px corner.
                'grid size-7.5 place-items-center',
                level,
                'font-medium text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&_svg]:size-4',
              )}
              aria-label={t.homeTitle}
              title={t.homeTitle}
            >
              <Home size={16} strokeWidth={1.9} aria-hidden="true" />
            </Link>
          )}
        </li>
        {parts.map((part, index) => {
          const last = index === lastIndex;
          return (
            <li key={`${index}-${part.label}`} className={cn('inline-flex min-w-0 items-center gap-0.5', last && 'flex-[0_1_auto] overflow-hidden')}>
              <span className="px-0.75 font-light text-faint" aria-hidden="true">/</span>
              {last ? (
                <span className={cn(level, 'font-semibold text-ink')} aria-current="page"><bdi>{part.label}</bdi></span>
              ) : part.href ? (
                <Link
                  href={part.href}
                  className={cn(level, 'font-medium text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent')}
                >
                  <bdi>{part.label}</bdi>
                </Link>
              ) : (
                <span className={cn(level, 'text-muted')}><bdi>{part.label}</bdi></span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
