// The prefix the resource routes are served under (ADR 0020): `/v1/…`. Every resource controller is declared with
// this list, and the middleware's single-route rules read it. Until slice R.11c the list also held `office`, the
// old prefix, served beside `/v1` for the releases between R.11b and R.11c.

export const RESOURCE_PREFIXES = ['v1'] as const;
export type ResourcePrefix = (typeof RESOURCE_PREFIXES)[number];

/** `@Controller(...)` takes a mutable array. */
export const RESOURCE_CONTROLLER_PREFIXES: string[] = [...RESOURCE_PREFIXES];

/** `/v1/x` for one resource path `x` (no leading slash): one entry a prefix served. */
export function resourcePaths(path: string): string[] {
  return RESOURCE_PREFIXES.map((prefix) => `/${prefix}/${path}`);
}

/**
 * The form a resource path has inside the duplicate guard's key. It is the path as the first prefix had it
 * (`/office/…`), and it stays so after that prefix stopped being served (slice R.11c): the key is a hash kept in
 * Redis for as long as a write is remembered, and a key taken by a release before the removal must still match the
 * same write repeated after it. It names no route and is compared with nothing but itself.
 */
const KEY_FORM = 'office';

/** The path a request is judged under in the duplicate guard's key: a resource path in its key form. */
export function canonicalPath(url: string): string {
  for (const prefix of RESOURCE_PREFIXES) {
    if (url === `/${prefix}` || url.startsWith(`/${prefix}/`)) return `/${KEY_FORM}${url.slice(prefix.length + 1)}`;
  }
  return url;
}
