import { api } from './api';
import type { ApiResult, DirectoryRow } from './api-types';


// The API serves the directory one bounded page at a time. The name map and the account pickers need every row, so
// they read the pages one after another, up to this many (200 accounts a page).
const MAX_PAGES = 50;

async function everyPage(mine: boolean): Promise<ApiResult<DirectoryRow[]>> {
  const rows: DirectoryRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.officeDirectory({ ...(mine ? { mine: '1' as const } : {}), ...(cursor ? { cursor } : {}) });
    if (!result.ok) return result;
    rows.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (!cursor) break;
  }
  return { ok: true, status: 200, data: rows };
}

/** Login name → full name of every account the viewer may meet on a screen. */
export async function directoryNames(): Promise<ApiResult<{ names: Record<string, string> }>> {
  const read = await everyPage(false);
  return read.ok ? { ok: true, status: 200, data: { names: Object.fromEntries(read.data.map((row) => [row.loginName, row.nickname])) } } : read;
}

/** Every account in the viewer's own tree, for the account pickers and the shell search. */
export async function everyAccount(): Promise<ApiResult<{ users: DirectoryRow[] }>> {
  const read = await everyPage(true);
  return read.ok ? { ok: true, status: 200, data: { users: read.data } } : read;
}
