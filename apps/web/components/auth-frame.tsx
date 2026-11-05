'use client';

import type { ReactNode } from 'react';
import { BrandLogo } from './brand-logo';
import { LanguageSwitch, ThemeToggle } from './chrome';
import { useBranding } from '../lib/branding';

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
  const branding = useBranding();
  return (
    <div className="auth">
      <div className="auth-tools">
        <LanguageSwitch />
        <ThemeToggle />
      </div>
      <main className="auth-card">
        {branding.logo ? (
          <BrandLogo className="auth-logo" />
        ) : (
          <div className="brand-mark" aria-hidden="true">
            <SimMark />
          </div>
        )}
        <p className="brand-name">{branding.name}</p>
        <p className="brand-sub">{branding.tagline}</p>
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
