// Company marks by URL (speed plan PF.7, spec 2026-11-17-scale-speed-cleanup "Pictures by URL"): the URL a list
// carries in place of the bytes and the version in it. What a picture is and how it decodes is shared
// (`site/rules/pictures.ts`).
import { createHash } from 'node:crypto';
import { PICTURES_PATH } from '../../site';

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
