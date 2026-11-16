'use client';

import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';
import { DataImage } from './data-image';

/**
 * The live preview beside the identity form: a browser tab, the sidebar head, and the sign-in
 * lockup, drawn from the draft so a change shows before it is saved. Logo copies swap with the
 * theme: the light copy shows by default and the dark one under `.dark` (base.css `.brand-logo*`).
 *
 * Its look (Tailwind migration T4.10), ported from desk/branding.css with base.css under it: a column 12px apart that
 * stays at the top while the page scrolls (not at 960px and under); its caption 12px semibold muted.
 * - The browser: clipped, a 1px `--rd-line` edge, 8px corners, `--rd-surface`, the card shadow. Its tab a row 8px
 *   apart, 8px / 12px padding, a hairline under it, `--rd-surface-2`, 12px: the 16px favicon (3px corners, cut to fill,
 *   on `--rd-primary-bg` while there is none), the name (600, one line, cut with an ellipsis), a muted ×. Its body a
 *   124px side beside the page, at least 132px high: the side a centred column 6px apart, 14px / 8px padding, a
 *   hairline at its end, the logo at most 92 × 44px or the name's first letter on a 40px `--rd-primary-bg` tile (8px
 *   corners, `--rd-primary-fg`, bold), the name 12px bold ink, the tagline 10px muted; the page three 8px pill lines
 *   on `--rd-surface-3`, 10px apart, 18px / 16px padding.
 * - The sign-in card: a centred column 8px apart, 22px / 16px padding, the browser's edge, corners, fill and shadow:
 *   the logo at most 160 × 56px, the name 15px bold ink, the tagline 11px muted 6px over the fields, two 30px fields
 *   (1px `--rd-field` edge, 6px corners, `--rd-surface`) and a 32px crimson button (`--rd-accent-fill`,
 *   `--rd-on-accent`, 12px bold), each the card's width up to 220px.
 */
const CARD = 'border border-line rounded-card bg-surface shadow-card';
const LINE = 'h-2 rounded-pill bg-surface-3';
const FIELD = 'h-7.5 w-full max-w-55 rounded-sm border border-field bg-surface';
export function BrandingPreview({
  name,
  tagline,
  logo,
  logoDark,
  favicon,
}: {
  name: string;
  tagline: string;
  logo: string;
  logoDark: string;
  favicon: string;
}) {
  const { t } = usePrefs();
  const initial = name.trim().charAt(0);
  // The two copies as a block contained within the given size: the light one, then the dark one under `.dark`.
  const logoPair = (size: string) => (logo ? (
    <>
      <DataImage src={logo} alt="" className={cn('block object-contain dark:hidden', size)} />
      <DataImage src={logoDark || logo} alt="" className={cn('hidden object-contain dark:block', size)} />
    </>
  ) : null);

  return (
    <aside className="sticky top-0 grid gap-3 max-[961px]:static" aria-label={t.brandingPreview}>
      <p className="m-0 text-sm font-semibold text-muted">{t.brandingPreview}</p>

      <div className={cn('overflow-hidden', CARD)} aria-label={t.brandingPreviewTab}>
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="size-4 flex-none overflow-hidden rounded-2xs bg-primary-bg" aria-hidden="true">
            {favicon && <DataImage src={favicon} alt="" className="block size-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
          <span className="text-muted" aria-hidden="true">×</span>
        </div>
        <div className="grid min-h-33 grid-cols-[124px_minmax(0,1fr)]">
          <div className="grid content-start justify-items-center gap-1.5 border-e border-line px-2 py-3.5 text-center" aria-label={t.brandingPreviewSidebar}>
            {logoPair('max-h-11 max-w-23') ?? (
              <span className="grid size-10 place-items-center rounded-card bg-primary-bg font-bold text-primary-fg" aria-hidden="true">{initial}</span>
            )}
            <span className="text-sm font-bold text-ink">{name}</span>
            <span className="text-2xs text-muted">{tagline}</span>
          </div>
          <div className="grid content-start gap-2.5 px-4 py-4.5" aria-hidden="true">
            <span className={LINE} style={{ width: '70%' }} />
            <span className={LINE} style={{ width: '45%' }} />
            <span className={LINE} style={{ width: '58%' }} />
          </div>
        </div>
      </div>

      <div className={cn('grid justify-items-center gap-2 px-4 py-5.5 text-center', CARD)} aria-label={t.brandingPreviewLogin}>
        {logoPair('max-h-14 max-w-40')}
        <span className="text-lg font-bold text-ink">{name}</span>
        <span className="mb-1.5 text-xs text-muted">{tagline}</span>
        <span className={FIELD} aria-hidden="true" />
        <span className={FIELD} aria-hidden="true" />
        <span className="grid h-8 w-full max-w-55 place-items-center rounded-sm bg-accent-fill text-sm font-bold text-on-accent" aria-hidden="true">{t.signIn}</span>
      </div>
    </aside>
  );
}
