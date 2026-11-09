'use client';

import { Moon, Sun } from 'lucide-react';
import { langLabel, langName, locales } from '../lib/copy';
import { usePrefs } from '../lib/prefs';
import { usePopover } from '../lib/use-popover';

export function ThemeToggle({ shell = false }: { shell?: boolean }) {
  const { theme, toggleTheme, t } = usePrefs();
  const label = theme === 'light' ? t.themeToDark : t.themeToLight;
  if (shell) {
    return (
      <button type="button" className="shell-icon" onClick={toggleTheme} aria-label={label} title={label}>
        <Sun className="shell-sun" size={18} strokeWidth={1.9} aria-hidden="true" />
        <Moon className="shell-moon" size={18} strokeWidth={1.9} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'light' ? (
        <Moon size={18} strokeWidth={1.9} aria-hidden="true" />
      ) : (
        <Sun size={18} strokeWidth={1.9} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * The language. `shell`: one button that steps to the next language (the drawer's foot on the narrowest phones).
 * Otherwise the menu the login page uses — the current language, a menu of the others; `topbar` draws its trigger
 * as a topbar control (spec 2026-11-09-admin-review, 2b).
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
        className="shell-icon shell-lang"
        onClick={() => setLocale(next)}
        aria-label={`${code} — ${langName[next]}`}
        title={langName[next]}
      >
        <span>{code}</span>
      </button>
    );
  }

  return (
    <div className={topbar ? 'lang topbar-lang' : 'lang'} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={topbar ? 'shell-icon shell-lang' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.language}
        onClick={toggle}
      >
        {langLabel[locale]}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={t.language}>
          {locales
            .filter((code) => code !== locale)
            .map((code) => (
              <button
                key={code}
                type="button"
                role="menuitem"
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
