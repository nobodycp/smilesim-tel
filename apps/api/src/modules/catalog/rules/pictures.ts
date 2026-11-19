// Company marks and offer pictures by URL (speed plan PF.7, spec 2026-11-17-scale-speed-cleanup "Pictures by URL"):
// the URL a list carries in place of the bytes, the version in it, and the bytes a stored data URL decodes to.
import { createHash } from 'node:crypto';

/** Where the web reaches the picture routes: `next.config.mjs` rewrites `/api/*` to the API. */
export const PICTURES_PATH = '/api/pictures';

export type PictureType = 'image/png' | 'image/jpeg' | 'image/webp';

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Whether a sent value is a picture the API stores: a PNG, JPEG or WebP data URL. A URL is not one. */
export function isPictureDataUrl(value: string): boolean {
  return DATA_URL.test(value);
}

/** The bytes and type behind a stored data URL; null when there is none or it is not a picture. */
export function decodePicture(dataUrl: string | null | undefined): { type: PictureType; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  return { type: match[1] as PictureType, bytes: Buffer.from(match[2], 'base64') };
}

/**
 * A company mark's version: the first 16 hex digits of the MD5 of the stored data URL. A company has no
 * `updatedAt`; this changes exactly when the picture does. The list reads compute the same in PostgreSQL
 * (`left(md5("image"), 16)`, `companies/company-marks.ts`) so the column never leaves the database.
 */
export function markVersion(dataUrl: string): string {
  return createHash('md5').update(dataUrl).digest('hex').slice(0, 16);
}

export function companyMarkUrl(code: string, version: string): string {
  return `${PICTURES_PATH}/postpaid/companies/${encodeURIComponent(code)}?v=${version}`;
}

/** An offer's version is its `updatedAt` in milliseconds. */
export function offerPictureUrl(id: string, updatedAt: Date): string {
  return `${PICTURES_PATH}/offers/${encodeURIComponent(id)}?v=${updatedAt.getTime()}`;
}
