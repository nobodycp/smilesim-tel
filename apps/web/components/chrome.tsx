'use client';

import { Moon, Sun } from 'lucide-react';
import { langLabel, langName, locales } from '../lib/copy';
import { usePrefs } from '../lib/prefs';
import { cn } from '../lib/cn';
import { usePopover } from '../lib/use-popover';
import { IconButton, iconButtonVariants } from './ui/icon-button';

/**
 * Every topbar control's box (Tailwind migration T3.1; legacy shell.css `.shell-icon` under graphite.css
 * `.topbar .shell-icon`): 44px under 768px, 36px from 768px, 6px corners, no border or fill, `--rd-ink-2` with an 18px
 * icon; under the pointer or while its panel is open the raised fill and ink; the ink focus outline. The menu button,
 * the notices, the theme and the language use it. Since Tailwind migration T6.3 it is `IconButton`'s `topbar` size
 * and tone (one icon-button recipe, audit 3.5-16).
 */
export const topbarIcon = cn(iconButtonVariants({ size: 'topbar', tone: 'topbar' }));

export function ThemeToggle({ shell = false }: { shell?: boolean }) {
  const { theme, toggleTheme, t } = usePrefs();
  const label = theme === 'light' ? t.themeToDark : t.themeToLight;
  if (shell) {
    return (
      // Both icons are drawn; the theme shows the moon on light and the sun on dark, so the first paint is right.
      <button type="button" className={topbarIcon} onClick={toggleTheme} aria-label={label} title={label}>
        <Sun className="hidden dark:block" size={18} strokeWidth={1.9} aria-hidden="true" />
        <Moon className="block dark:hidden" size={18} strokeWidth={1.9} aria-hidden="true" />
      </button>
    );
  }
  return (
    <IconButton onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'light' ? (
        <Moon size={18} strokeWidth={1.9} aria-hidden="true" />
      ) : (
        <Sun size={18} strokeWidth={1.9} aria-hidden="true" />
      )}
    </IconButton>
  );
}

/**
 * The language. `shell`: one button that steps to the next language (no caller draws it today; it keeps the legacy
 * `.shell-icon` look outside the topbar: 40px, 44px under 768px, bordered on the surface). Otherwise the menu the
 * login page uses — the current language (34px, bordered on the surface, 12px extra bold), a menu of the others;
 * `topbar` draws its trigger as a topbar control (spec 2026-11-09-admin-review, 2b). The menu: under the trigger at
 * its end, at least 148px, 6px padding, 8px corners, bordered on the surface with `--rd-shadow-pop`; its lines 36px,
 * `--rd-ink-2` semibold, the raised fill under the pointer.
 */
export function LanguageSwitch({ shell = false, topbar = false }: { shell?: boolean; topbar?: boolean }) {
  const { locale, setLocale, t } = usePrefs();
  const { open, close, toggle, root, trigger } = usePopover({ menu: true });

  if (shell) {
    const order = locales;
    const next = order[(order.indexOf(locale) + 1) % order.length] ?? 'ar';
    const code = next === 'en' ? 'EN' : next === 'he' ? 'HE' : 'AR';
    return (
      <button
        type="button"
        className={cn(
          'inline-flex size-10 min-w-10 items-center justify-center rounded-sm border border-solid border-line bg-surface p-0',
          'text-md font-bold tracking-code text-ink hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-ink max-md:size-11 max-md:min-w-11',
        )}
        data-testid="shell-lang"
        onClick={() => setLocale(next)}
        aria-label={`${code} — ${langName[next]}`}
        title={langName[next]}
      >
        <span className="[direction:ltr] [unicode-bidi:isolate]">{code}</span>
      </button>
    );
  }

  return (
    <div className="relative" data-testid="lang-switch" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={
          topbar
            ? cn(topbarIcon, 'text-md font-bold tracking-code')
            : cn(
                'h-8.5 min-w-8.5 rounded-sm border border-solid border-line bg-surface px-2 py-0 text-sm font-bold text-ink-2',
                'hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
              )
        }
        data-testid={topbar ? 'shell-lang' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.language}
        onClick={toggle}
      >
        {langLabel[locale]}
      </button>
      {open && (
        <div
          className="absolute end-0 top-pop z-popover min-w-37 rounded-card border border-solid border-line bg-surface p-1.5 shadow-pop"
          role="menu"
          aria-label={t.language}
        >
          {locales
            .filter((code) => code !== locale)
            .map((code) => (
              <button
                key={code}
                type="button"
                role="menuitem"
                className="flex h-9 w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2.5 py-0 text-start font-semibold text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
                onClick={() => {
                  setLocale(code);
                  close();
                }}
              >
                {langName[code]}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
