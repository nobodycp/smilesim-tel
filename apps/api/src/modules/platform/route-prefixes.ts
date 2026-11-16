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
