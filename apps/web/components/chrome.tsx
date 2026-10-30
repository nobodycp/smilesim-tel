'use client';

import { useEffect, useRef, useState } from 'react';
import { langLabel, langName, locales } from '../lib/copy';
import { usePrefs } from '../lib/prefs';

export function ThemeToggle({ shell = false }: { shell?: boolean }) {
  const { theme, toggleTheme, t } = usePrefs();
  const label = theme === 'light' ? t.themeToDark : t.themeToLight;
  if (shell) {
    return (
      <button type="button" className="shell-icon" onClick={toggleTheme} aria-label={label} title={label}>
        <SunIcon />
        <MoonIcon />
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={label} title={label}>
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

export function LanguageSwitch({ shell = false }: { shell?: boolean }) {
  const { locale, setLocale, t } = usePrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
    <div className="lang" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.language}
        onClick={() => setOpen((value) => !value)}
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
                  setOpen(false);
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

function SunIcon() {
  return (
    <svg className="shell-sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="shell-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
