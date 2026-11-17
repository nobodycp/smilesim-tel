import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WebVersions } from './versions';

// The web server's own versions (spec 2026-11-17-system-monitor, section 5), read on the web server only
// (app/system/versions/data): the API cannot see what the web runs. Node imports: never import this file from a client component.

/** The web's libraries the versions page lists (the API's `STACK` entries whose `where` is `web`). */
const WEB_LIBRARIES = ['next', 'react', 'tailwindcss'] as const;

/** At most this many folders are climbed from the web's folder to find `node_modules`: apps/web to the root is two. */
const LEVELS_UP = 4;

/**
 * The installed version of a package, from its own `package.json` in the nearest `node_modules` above the web's
 * folder (the web's own first, then the workspace root where npm hoists them), not the range the web's
 * `package.json` asks for. Read as a file, never `require`d, so nothing of the package runs and its `exports`
 * cannot hide the file. Null when it is not installed or has no version.
 */
function installedVersion(name: string, from: string): string | null {
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

let known: WebVersions | null = null;

/** What the web server runs. Installed versions do not change while the process runs: read once. */
export function webVersions(): WebVersions {
  // `next dev` and `next start` both run from the web's folder (apps/web; the Dockerfile's WORKDIR too).
  known ??= {
    nodejs: process.version,
    libraries: Object.fromEntries(WEB_LIBRARIES.map((name) => [name, installedVersion(name, process.cwd())])),
  };
  return known;
}
