// The prefixes the resource routes are served under (ADR 0020, slice R.11b): `/v1/…`, the clear path the web calls,
// and `/office/…`, the old one, kept for one release so that an older web and an older rollback image keep working.
// Every resource controller is declared with this list, and the middleware's single-route rules and the duplicate
// guard's key read it, so the two paths of a route are one route. Removing `office` from here (slice R.11c) is the
// whole removal; it waits for the count of old-path hits to be zero for a release (`legacy-paths.ts`).

/** The current prefix first: the one the web calls. */
export const RESOURCE_PREFIXES = ['v1', 'office'] as const;
export type ResourcePrefix = (typeof RESOURCE_PREFIXES)[number];
/** The prefix kept for compatibility, counted when used. */
export const LEGACY_PREFIX: ResourcePrefix = 'office';

/** `@Controller(...)` takes a mutable array. */
export const RESOURCE_CONTROLLER_PREFIXES: string[] = [...RESOURCE_PREFIXES];

/** `/v1/x`, `/office/x` and `x` itself, for one resource path `x` (no leading slash). */
export function resourcePaths(path: string): string[] {
  return RESOURCE_PREFIXES.map((prefix) => `/${prefix}/${path}`);
}

/**
 * The path a request is judged under when two paths are one route (the duplicate guard's key): any resource prefix
 * becomes the legacy one, so a write sent to `/v1/x` and repeated to `/office/x` is one write, and a key taken
 * before the second path existed still matches.
 */
export function canonicalPath(url: string): string {
  for (const prefix of RESOURCE_PREFIXES) {
    if (url === `/${prefix}` || url.startsWith(`/${prefix}/`)) return `/${LEGACY_PREFIX}${url.slice(prefix.length + 1)}`;
  }
  return url;
}
