import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** At most this many folders are climbed from here to find `node_modules`: from `src/` or `dist/` to the repository's root is five. */
const LEVELS_UP = 8;

/**
 * The installed version of a package, from its own `package.json` in the nearest `node_modules` above this file:
 * the API's own folder first, then the workspace root where npm hoists most of them; from `src/` and from `dist/`
 * alike. Read as a file, never `require`d, so nothing of the package runs and its `exports` cannot hide the file.
 * Null when it is not installed or its file has no version.
 */
export function installedVersion(name: string, from: string = __dirname): string | null {
  let dir = from;
  for (let level = 0; level <= LEVELS_UP; level += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: unknown };
      return typeof manifest.version === 'string' ? manifest.version.slice(0, 64) : null;
    } catch {
      // Not here: one folder up.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Installed versions do not change while the process runs: each is read once. */
const known = new Map<string, string | null>();

export function installedVersionOnce(name: string): string | null {
  if (!known.has(name)) known.set(name, installedVersion(name));
  return known.get(name) ?? null;
}
