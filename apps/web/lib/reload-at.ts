/**
 * Leaves for `path` with a full page load, not a client navigation. Used when the account itself changes (entering
 * or leaving another account, a session that ended): the load drops every piece of account state held in memory,
 * the query cache included, which a router push would keep.
 */
export function reloadAt(path: string) {
  window.location.assign(path);
}
