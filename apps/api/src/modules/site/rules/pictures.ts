// Pictures by URL (speed plan PF.7, spec 2026-11-17-scale-speed-cleanup "Pictures by URL"): the URL a list carries
// in place of the bytes and the bytes a stored data URL decodes to. Shared by every line: an offer's picture here,
// and a company mark in the postpaid catalog (`postpaid/catalog/rules/pictures.ts`).

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

/** An offer's version is its `updatedAt` in milliseconds. */
export function offerPictureUrl(id: string, updatedAt: Date): string {
  return `${PICTURES_PATH}/offers/${encodeURIComponent(id)}?v=${updatedAt.getTime()}`;
}
