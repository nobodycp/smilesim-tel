// Server-side read of the office identity for the layout and its metadata. It never throws:
// an API that is down or slow answers the defaults, so the office still draws.
import type { BrandingSummary } from './api';

export const DEFAULT_BRANDING: BrandingSummary = { siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 };

const TIMEOUT_MS = 1500;

function isSummary(value: unknown): value is BrandingSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.siteName === 'string' && typeof row.tagline === 'string' && typeof row.version === 'number';
}

export async function loadBranding(): Promise<BrandingSummary> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  try {
    const response = await fetch(`${base}/branding`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return DEFAULT_BRANDING;
    const body: unknown = await response.json();
    if (!isSummary(body)) return DEFAULT_BRANDING;
    return {
      siteName: body.siteName,
      tagline: body.tagline,
      hasLogo: Boolean(body.hasLogo),
      hasFavicon: Boolean(body.hasFavicon),
      version: body.version,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Same-origin URL of one identity image; the Next rewrite forwards `/api` to the API. */
export function brandingImageUrl(kind: 'logo' | 'logo-dark' | 'favicon', version: number): string {
  return `/api/branding/${kind}?v=${version}`;
}
