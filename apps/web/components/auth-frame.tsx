'use client';

import type { ReactNode } from 'react';
import { LanguageSwitch, ThemeToggle } from './chrome';
import { usePrefs } from '../lib/prefs';

export function AuthFrame({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  const { t } = usePrefs();
  return (
    <div className="auth">
      <div className="auth-tools">
        <LanguageSwitch />
        <ThemeToggle />
      </div>
      <main className="auth-card">
        <div className="brand-mark" aria-hidden="true">
          <SimMark />
        </div>
        <p className="brand-name">{t.brand}</p>
        <p className="brand-sub">{t.brandSub}</p>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {children}
      </main>
    </div>
  );
}

function SimMark() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M7 3.5h6.2L19 9.2V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7z" />
      <path d="M9 13.5h6v6H9z" />
    </svg>
  );
}
