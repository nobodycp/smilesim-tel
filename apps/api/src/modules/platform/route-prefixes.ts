// The prefix the resource routes are served under (ADR 0020): `/v1/…`. Every resource controller is declared with
// this list, and the middleware's single-route rules read it.

export const RESOURCE_PREFIXES = ['v1'] as const;
export type ResourcePrefix = (typeof RESOURCE_PREFIXES)[number];

/** `@Controller(...)` takes a mutable array. */
export const RESOURCE_CONTROLLER_PREFIXES: string[] = [...RESOURCE_PREFIXES];

/** `/v1/x` for one resource path `x` (no leading slash): one entry a prefix served. */
export function resourcePaths(path: string): string[] {
  return RESOURCE_PREFIXES.map((prefix) => `/${prefix}/${path}`);
}

/**
 * A request's path as the router matches it, for the rules that name one route (the sign-in limit, the stream's
 * exemption, the routes that start a session): without the query, in lower case and with no trailing slash. The
 * router takes `/auth/login/` and `/AUTH/LOGIN` for `/auth/login`; a rule that compared the path as it was sent
 * missed them.
 */
export function routePath(url: string | undefined): string {
  const path = String(url ?? '').split('?')[0].toLowerCase().replace(/\/+$/, '');
  return path || '/';
}

