'use client';

import type { ReactNode } from 'react';
import { AuthArt, AuthBrand } from './auth-art';
import { LanguageSwitch, ThemeToggle } from './chrome';

/*
 * The sign-in frame's parts, shared by the sign-in, password and two-step pages: the form on the reading side and the art beside
 * it (1 : 1.1), stacked under 861px with the art below; the theme and language tools in the form side's top end
 * corner; a 380px column, 14px apart; the head 18px under the brand row, 8px apart.
 */
export const authClass = {
  frame: 'grid min-h-dvh grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] bg-bg max-auth:grid-cols-1',
  side: 'relative grid place-items-center px-10 pt-18 pb-10 max-auth:px-5 max-auth:pb-8',
  tools: 'absolute end-4 top-4 flex gap-2',
  card: 'grid w-[min(380px,100%)] gap-3.5 text-start',
  head: 'mt-4.5 grid justify-items-start gap-2',
  /** The title: 26px, bold, -0.015em, 1.25 line height. */
  title: 'm-0 text-6xl leading-tight font-bold tracking-title text-ink',
  /** The form: a grid, its rows at the top, 14px apart. */
  form: 'grid content-start gap-3.5',
} as const;

/**
 * A text field on the password and two-step pages: `Input size="lg"` (42px, the inset look), kept 42px under 721px
 * too, where `Input` otherwise grows to 44px.
 */
export const authInputClass = 'max-touch:h-10.5';

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
    <div data-slot="auth" className={authClass.frame}>
      <section className={authClass.side}>
        <div className={authClass.tools}>
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <main className={authClass.card}>
          <AuthBrand />
          <div className={authClass.head}>
            <p className="m-0 text-xs font-bold tracking-head text-muted">{kicker}</p>
            <h1 className={authClass.title}>{title}</h1>
            {/* No empty line under the title when a page has no lede (audit 3.3-34). */}
            {lede ? <p className="m-0 text-muted">{lede}</p> : null}
          </div>
          {children}
        </main>
      </section>
      <AuthArt />
    </div>
  );
}
