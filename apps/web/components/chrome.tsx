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
        <Sun className="shell-sun" size={18} strokeWidth={2.2} aria-hidden="true" />
        <Moon className="shell-moon" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'light' ? (
        <Moon size={18} strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <Sun size={18} strokeWidth={2.2} aria-hidden="true" />
      )}
    </button>
  );
}

export function LanguageSwitch({ shell = false }: { shell?: boolean }) {
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
    <div className="lang" ref={root}>
      <button
        ref={trigger}
        type="button"
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
