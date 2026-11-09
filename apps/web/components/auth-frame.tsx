'use client';

import type { ReactNode } from 'react';
import { AuthArt, AuthBrand } from './auth-art';
import { LanguageSwitch, ThemeToggle } from './chrome';

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
  // Graphite (spec 2026-11-09-graphite-identity): the same split as the sign-in page — form and art.
  return (
    <div className="gauth">
      <section className="gauth-form">
        <div className="gauth-tools">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <main className="gauth-card auth-card">
          <AuthBrand />
          <div className="gauth-head">
            <p className="eyebrow">{kicker}</p>
            <h1>{title}</h1>
            <p className="lede">{lede}</p>
          </div>
          {children}
        </main>
      </section>
      <AuthArt />
    </div>
  );
}
