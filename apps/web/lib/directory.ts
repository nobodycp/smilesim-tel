import { allPages } from './all-pages';
import { api } from './api';
import type { ApiResult, DirectoryRow } from './api-types';

// The directory is served in pages (200 accounts each); the name map and the account pickers need every row.

/** Login name → full name of every account the viewer may meet on a screen. */
export async function directoryNames(): Promise<ApiResult<{ names: Record<string, string> }>> {
  const read = await allPages((cursor) => api.officeDirectory(cursor ? { cursor } : undefined));
  return read.ok ? { ...read, data: { names: Object.fromEntries(read.data.rows.map((row) => [row.loginName, row.nickname])) } } : read;
}

/** Every account in the viewer's own tree, for the account pickers and the shell search. */
export async function everyAccount(): Promise<ApiResult<{ users: DirectoryRow[] }>> {
  const read = await allPages((cursor) => api.officeDirectory({ mine: '1', ...(cursor ? { cursor } : {}) }));
  return read.ok ? { ...read, data: { users: read.data.rows } } : read;
}
