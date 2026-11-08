// The users list, paged by the server. The list is ordered by layer (branch, main agent, agent, point of sale)
// and then by login name, the order the desk always drew; `q` matches the login or the full name as typed, and
// `layer` keeps one layer. Pure: the service hands it the accounts the actor may see.

export const USERS_PAGE = 50;
export const USER_LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

export type UsersFilter = { q?: string; layer?: string; cursor?: string };
type Row = { loginName: string; nickname: string; layer: string };

const rank = (layer: string) => USER_LAYERS.indexOf(layer as (typeof USER_LAYERS)[number]);

function compare(a: { rank: number; login: string }, b: { rank: number; login: string }) {
  return a.rank - b.rank || a.login.localeCompare(b.login);
}

/** The cursor names the last row of a page by its place in the order, so a deleted row does not lose the place. */
export function cursorOf(row: Row) {
  return `${rank(row.layer)}:${row.loginName}`;
}

function readCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const at = cursor.indexOf(':');
  const value = Number(cursor.slice(0, at));
  return at > 0 && Number.isInteger(value) ? { rank: value, login: cursor.slice(at + 1) } : null;
}

export function usersPage<T extends Row>(rows: T[], filter: UsersFilter, size = USERS_PAGE) {
  const needle = (filter.q ?? '').trim();
  const layer = USER_LAYERS.find((value) => value === filter.layer);
  const matching = rows
    .filter((row) => !layer || row.layer === layer)
    .filter((row) => !needle || row.nickname.includes(needle) || row.loginName.includes(needle))
    .sort((a, b) => compare({ rank: rank(a.layer), login: a.loginName }, { rank: rank(b.layer), login: b.loginName }));
  const after = readCursor(filter.cursor);
  const start = after ? matching.findIndex((row) => compare({ rank: rank(row.layer), login: row.loginName }, after) > 0) : 0;
  const from = start < 0 ? matching.length : start;
  const page = matching.slice(from, from + size);
  const last = page[page.length - 1];
  return { page, nextCursor: from + size < matching.length && last ? cursorOf(last) : null, total: matching.length };
}
