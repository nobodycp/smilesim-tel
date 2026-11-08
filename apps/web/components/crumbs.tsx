'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useCrumbNames } from '../lib/crumbs';
import { usePageTitleValue } from '../lib/page-title';
import { usePrefs } from '../lib/prefs';

/**
 * The trail above a detail page, in place of a back button: the section, then each level down to the page itself
 * (spec 2026-11-08-inner-pages-refresh, §1). `sections` maps a sidebar path to its label. A level shows the name its
 * page registered (`useCrumbs`), the page's title for the last level, or the raw segment until then.
 */
export function Crumbs({ pathname, sections }: { pathname: string; sections: { href: string; label: string }[] }) {
  const { locale, t } = usePrefs();
  const names = useCrumbNames();
  const title = usePageTitleValue();
  const section = sections
    .filter((item) => item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!section || section.href === pathname) return null;

  const rest = pathname.slice(section.href.length).split('/').filter(Boolean);
  const parts = [{ href: section.href, label: section.label }];
  let path = section.href;
  rest.forEach((segment, index) => {
    path = `${path}/${segment}`;
    const last = index === rest.length - 1;
    let raw = segment;
    try {
      raw = decodeURIComponent(segment);
    } catch {
      raw = segment;
    }
    parts.push({ href: path, label: names[path] || (last && title) || raw });
  });
  const Separator = locale === 'en' ? ChevronRight : ChevronLeft;

  return (
    <nav className="crumbs" aria-label={t.breadcrumb}>
      <ol>
        {parts.map((part, index) => {
          const last = index === parts.length - 1;
          return (
            <li key={part.href}>
              {last ? (
                <span aria-current="page">{part.label}</span>
              ) : (
                <>
                  <Link href={part.href}>{part.label}</Link>
                  <Separator className="crumbs-sep" aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
