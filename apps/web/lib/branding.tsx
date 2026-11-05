'use client';

// The office identity, resolved for the screen: the saved name and tagline or the locale defaults,
// and same-origin image URLs ('' when no image is saved). Seeded once by the layout.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { BrandingSummary } from './api';
import { brandingImageUrl, DEFAULT_BRANDING } from './branding-load';
import { usePrefs } from './prefs';

export type Branding = {
  name: string;
  tagline: string;
  logo: string;
  logoDark: string;
  favicon: string;
  version: number;
};

const BrandingContext = createContext<BrandingSummary>(DEFAULT_BRANDING);

export function BrandingProvider({ seed, children }: { seed: BrandingSummary; children: ReactNode }) {
  return <BrandingContext.Provider value={seed}>{children}</BrandingContext.Provider>;
}

/** Turns a summary into what a screen draws, with the locale defaults filled in. */
export function resolveBranding(seed: BrandingSummary, defaults: { brand: string; brandSub: string }): Branding {
  return {
    name: seed.siteName || defaults.brand,
    tagline: seed.tagline || defaults.brandSub,
    logo: seed.hasLogo ? brandingImageUrl('logo', seed.version) : '',
    logoDark: seed.hasLogo ? brandingImageUrl('logo-dark', seed.version) : '',
    favicon: seed.hasFavicon ? brandingImageUrl('favicon', seed.version) : '',
    version: seed.version,
  };
}

export function useBranding(): Branding {
  const seed = useContext(BrandingContext);
  const { t } = usePrefs();
  return useMemo(() => resolveBranding(seed, { brand: t.brand, brandSub: t.brandSub }), [seed, t.brand, t.brandSub]);
}
