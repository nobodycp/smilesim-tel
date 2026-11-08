// The office identity rules, pure: what a saved row looks like, what a PUT body may carry,
// and how a stored data URL becomes bytes for the image routes.
import { OfficeFailure } from '../office/office-failure';

export const NAME_LIMIT = 120;
export const TAGLINE_LIMIT = 160;
/** Decoded bytes per image. A 768px webp logo and its dark copy stay well under it. */
export const IMAGE_LIMIT = 300_000;

export type ImageType = 'image/png' | 'image/webp';

export type BrandingRow = {
  siteName: string;
  tagline: string;
  logo: string | null;
  logoDark: string | null;
  favicon: string | null;
  updatedAt: Date;
};

export type BrandingBody = {
  siteName: string;
  tagline: string;
  logo: string | null;
  logoDark: string | null;
  favicon: string | null;
};

export type BrandingSummary = {
  siteName: string;
  tagline: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  /** `updatedAt` in milliseconds; 0 when nothing was ever saved. Appended as `?v=` to image URLs. */
  version: number;
};

const DATA_URL = /^data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)$/;

function invalid(): never {
  throw new OfficeFailure(400, 'INVALID');
}

function textOf(value: unknown, limit: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') invalid();
  const trimmed = value.trim();
  if (trimmed.length > limit) invalid();
  return trimmed;
}

function imageOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') invalid();
  const decoded = decodeImage(value);
  if (!decoded || decoded.bytes.length < 16 || decoded.bytes.length > IMAGE_LIMIT) invalid();
  return value;
}

/** The body of PUT /branding, trimmed and checked. Throws INVALID on any violated limit. */
export function parseBrandingBody(body: unknown): BrandingBody {
  if (!body || typeof body !== 'object') invalid();
  const input = body as Record<string, unknown>;
  return {
    siteName: textOf(input.siteName, NAME_LIMIT),
    tagline: textOf(input.tagline, TAGLINE_LIMIT),
    logo: imageOf(input.logo),
    logoDark: imageOf(input.logoDark),
    favicon: imageOf(input.favicon),
  };
}

/** The bytes and type behind a stored data URL; null when there is none or it is malformed. */
export function decodeImage(dataUrl: string | null): { type: ImageType; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  return { type: `image/${match[1]}` as ImageType, bytes: Buffer.from(match[2], 'base64') };
}

/** What GET /branding answers; safe on a missing row. */
export function brandingSummary(row: BrandingRow | null): BrandingSummary {
  return {
    siteName: row?.siteName ?? '',
    tagline: row?.tagline ?? '',
    hasLogo: Boolean(row?.logo),
    hasFavicon: Boolean(row?.favicon),
    version: row ? row.updatedAt.getTime() : 0,
  };
}
