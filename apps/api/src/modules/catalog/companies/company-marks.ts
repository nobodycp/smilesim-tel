import type { Db } from '../../platform';
import { companyMarkUrl } from '../rules/pictures';

/**
 * The URL of every company mark that is set, by company code (speed plan PF.7). The one read of the marks the
 * lists use (the companies shelf, the priced shelf, the providers list): raw SQL because Prisma cannot select a
 * hash of a column without reading it; the picture itself never leaves the database. A company without a mark is
 * not in the map.
 */
export async function companyMarkUrls(db: Db): Promise<Map<string, string>> {
  const rows = await db.$queryRaw<{ code: string; version: string }[]>`
    SELECT "code", left(md5("image"), 16) AS "version" FROM "Company" WHERE COALESCE("image", '') <> ''`;
  return new Map(rows.map((row) => [row.code, companyMarkUrl(row.code, row.version)]));
}
