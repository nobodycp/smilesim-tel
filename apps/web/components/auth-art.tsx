import { Wifi } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { useBranding } from '../lib/branding';
import { usePrefs } from '../lib/prefs';
import { cn } from '../lib/cn';

/*
 * The sign-in art and brand row (Tailwind migration T3.2), ported from graphite.css's sign-in block: the art panel is
 * always dark (`--rd-login-room` under a crimson glow at 22%), padded 44px (28px 24px and at least 220px high under
 * 861px); the crimson tag (380px, 220px under 861px) rises from the reading start's bottom corner, turned -14deg with
 * its cut corner, and the title and line rise in after it. The tag's turn is `transform`, not Tailwind's `rotate`,
 * because the `gauth-tag` keyframes (app/tailwind.css) animate `transform`.
 */

/** The crimson cut tile with the signal mark, when no logo is saved. The cut corner sits at the reading end. */
const markClass = cn(
  'grid size-11 flex-none place-items-center rounded-sm bg-accent-fill text-on-accent',
  '[clip-path:polygon(0_0,calc(100%-11px)_0,100%_11px,100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(11px_0,100%_0,100%_100%,0_100%,0_11px)]',
);

/**
 * The Graphite sign-in art (spec 2026-11-09-graphite-identity, from design/night-desk-family): a dark panel with the
 * crimson tag rising from its corner and one line about the office. Decoration beside the form, hidden from
 * assistive tech.
 */
export function AuthArt() {
  const { t } = usePrefs();
  const branding = useBranding();
  return (
    <aside
      data-slot="auth-art"
      className={cn(
        'relative flex min-h-full flex-col justify-end overflow-hidden p-11 text-login-ink',
        'bg-login-room bg-radial-[90%_70%_at_30%_70%] from-accent/22 to-transparent to-70%',
        'max-[861px]:min-h-55 max-[861px]:px-6 max-[861px]:py-7',
      )}
      aria-hidden="true"
    >
      <div
        className={cn(
          'absolute -start-10 -bottom-15 size-95 bg-accent-fill opacity-88 [transform:rotate(-14deg)]',
          '[clip-path:polygon(0_0,78%_0,100%_22%,100%_100%,0_100%)]',
          'max-[861px]:-bottom-12.5 max-[861px]:size-55',
          'motion-safe:animate-[gauth-tag_900ms_var(--rd-ease-out)_both]',
        )}
      />
      <div className="absolute start-11 top-10 max-[861px]:start-6 max-[861px]:top-6">
        {branding.logo ? <BrandLogo className="max-h-11 max-w-14" onInk /> : <span className={markClass}><Wifi size={24} strokeWidth={1.9} /></span>}
      </div>
      <h2
        className={cn(
          'relative mx-0 mt-0 mb-2 max-w-[12em] text-[30px] leading-[1.4] font-bold max-[861px]:text-[22px]',
          'motion-safe:animate-[rd-rise_600ms_200ms_var(--rd-ease-out)_both]',
        )}
      >
        {t.loginArtTitle}
      </h2>
      <p className="relative m-0 max-w-[26em] motion-safe:animate-[rd-rise_600ms_200ms_var(--rd-ease-out)_both]">{t.loginArtText}</p>
    </aside>
  );
}

/** The brand row above a sign-in form: the saved logo, or the crimson cut tile; the name and the tagline. */
export function AuthBrand() {
  const branding = useBranding();
  return (
    <div className="flex items-center gap-3">
      {branding.logo ? (
        <BrandLogo className="max-h-11 max-w-14" />
      ) : (
        <span className={markClass} aria-hidden="true"><Wifi size={22} strokeWidth={1.9} /></span>
      )}
      <div>
        <b className="block text-[20px] leading-[1.3] font-bold text-ink">{branding.name}</b>
        <small className="block text-sm text-muted">{branding.tagline}</small>
      </div>
    </div>
  );
}
