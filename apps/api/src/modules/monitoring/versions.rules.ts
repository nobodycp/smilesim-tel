// The versions page's rules (spec 2026-11-17-system-monitor, section 5; slice M.11): the components the system runs
// on, how a version is read and compared, how far one in use is behind the newest, and which runtime cycle a
// version belongs to. Pure (backend-engineering.mdc 5.1): no Nest, no Prisma, no clock but the one handed in.

export type StackKind = 'runtime' | 'library';
/** Where a component runs: the API, the worker, the web server, the database, the cache. */
export type StackPlace = 'api' | 'worker' | 'web' | 'database' | 'cache';

/**
 * The components the versions page lists, in its order: the runtimes, then the libraries. A runtime's name is its
 * endoflife.date product, a library's its npm package. The web's own (Next.js, React, Tailwind CSS, the web's
 * Node.js) are checked here too so the page can compare them, but what the web runs is the web's to read.
 */
export const STACK = [
  { name: 'nodejs', kind: 'runtime', where: ['api', 'worker', 'web'] },
  { name: 'postgresql', kind: 'runtime', where: ['database'] },
  { name: 'redis', kind: 'runtime', where: ['cache'] },
  { name: 'next', kind: 'library', where: ['web'] },
  { name: 'react', kind: 'library', where: ['web'] },
  { name: 'tailwindcss', kind: 'library', where: ['web'] },
  { name: '@nestjs/core', kind: 'library', where: ['api'] },
  { name: 'prisma', kind: 'library', where: ['api'] },
  { name: '@prisma/client', kind: 'library', where: ['api'] },
  { name: 'bullmq', kind: 'library', where: ['api'] },
  { name: 'typescript', kind: 'library', where: ['api'] },
  { name: 'zod', kind: 'library', where: ['api'] },
  { name: 'express', kind: 'library', where: ['api'] },
  { name: 'argon2', kind: 'library', where: ['api'] },
] as const satisfies readonly { name: string; kind: StackKind; where: readonly StackPlace[] }[];

export type StackComponent = { name: string; kind: StackKind };

/** A version read: its numbers as written (one to three), and whether it carries a pre-release tag. */
type Parsed = { parts: number[]; pre: boolean };

/**
 * Reads `v24.21.0`, `17.6`, `7.4.1`, `19.0.0-rc.1`, `19beta1`, `17.6 (Debian 17.6-1.pgdg120+1)`: a `v` and spaces
 * before are dropped, then up to three numbers; a tag right after them (`-rc.1`, `beta1`) is a pre-release, a build
 * (`+…`) or anything after a space is ignored. Null when it starts with no number.
 */
export function parseVersion(text: string | null | undefined): Parsed | null {
  if (typeof text !== 'string') return null;
  const found = /^\s*[vV]?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(.*)$/s.exec(text);
  if (!found) return null;
  const parts = [found[1], found[2], found[3]].filter((part): part is string => part !== undefined).map(Number);
  const rest = found[4];
  return { parts, pre: /^(?:-|[A-Za-z])/.test(rest) };
}

/** The numbers and tag of a version, without what follows them: `17.6 (Debian …)` → `17.6`. Null when unreadable. */
export function plainVersion(text: string | null | undefined): string | null {
  const found = typeof text === 'string' ? /^\s*([vV]?\d{1,9}(?:\.\d{1,9}){0,2}(?:-[0-9A-Za-z.-]{1,40}|[A-Za-z][0-9A-Za-z.]{0,40})?)/.exec(text) : null;
  return found ? found[1] : null;
}

/**
 * Two versions as three numbers each. A version written with two numbers on both sides (PostgreSQL's `17.6`) is
 * major and patch: PostgreSQL has no minor since 10. Otherwise a missing number is 0 (`7.4` is `7.4.0`).
 */
function aligned(a: Parsed, b: Parsed): [number[], number[]] {
  const twoPart = a.parts.length <= 2 && b.parts.length <= 2;
  const three = (parts: number[]) => (twoPart ? [parts[0], 0, parts[1] ?? 0] : [parts[0], parts[1] ?? 0, parts[2] ?? 0]);
  return [three(a.parts), three(b.parts)];
}

/** Negative when `a` is older, positive when newer, 0 when the same; a pre-release is older than its release. Null when either is unreadable. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  const [x, y] = aligned(left, right);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return Number(right.pre) - Number(left.pre);
}

/** Whether `next` is newer than `previous`; false when either is unreadable. */
export function isNewer(next: string | null | undefined, previous: string | null | undefined): boolean {
  return (compareVersions(next, previous) ?? 0) > 0;
}

export type Behind = 'none' | 'patch' | 'minor' | 'major' | 'unknown';

/**
 * How far `current` is behind `latest`, by the first number that differs: `major`, `minor` or `patch`; `none` when
 * `current` is the same or newer; `unknown` when either is missing or unreadable. Two-number versions on both sides
 * (PostgreSQL) are major and patch. A pre-release of the newest numbers is a `patch` behind it.
 */
export function behindOf(current: string | null | undefined, latest: string | null | undefined): Behind {
  const left = parseVersion(current);
  const right = parseVersion(latest);
  if (!left || !right) return 'unknown';
  if ((compareVersions(current, latest) ?? 0) >= 0) return 'none';
  const [x, y] = aligned(left, right);
  if (x[0] !== y[0]) return 'major';
  if (x[1] !== y[1]) return 'minor';
  return 'patch';
}

/** A runtime's cycle as stored: `eol` is the date support ends (`YYYY-MM-DD`), or `true` / `false` when undated. */
export type Cycle = { cycle: string; latest: string; eol: string | boolean };

/**
 * The cycle a version belongs to: the longest cycle name that is the version or starts it before a dot (`24` for
 * `v24.21.0`, `7.4` for `7.4.1`, `17` for `17.6`). Null when none is.
 */
export function cycleOf(version: string | null | undefined, cycles: Cycle[]): Cycle | null {
  const plain = plainVersion(version)?.replace(/^[vV]/, '');
  if (!plain) return null;
  const matching = cycles.filter((cycle) => plain === cycle.cycle || plain.startsWith(`${cycle.cycle}.`));
  return matching.sort((a, b) => b.cycle.length - a.cycle.length)[0] ?? null;
}

/** The newest version of all cycles, pre-releases left out; null when there is none. */
export function newestOf(cycles: Cycle[]): string | null {
  const released = cycles.map((cycle) => cycle.latest).filter((latest) => parseVersion(latest) && !parseVersion(latest)?.pre);
  return released.reduce<string | null>((found, latest) => (found === null || isNewer(latest, found) ? latest : found), null);
}

/** When a cycle's support ends (a date, or null when undated), and whether it already has on `today` (`YYYY-MM-DD`). */
export function supportOf(cycle: Cycle | null, today: string): { supportEnds: string | null; supportEnded: boolean } {
  if (!cycle) return { supportEnds: null, supportEnded: false };
  if (typeof cycle.eol === 'boolean') return { supportEnds: null, supportEnded: cycle.eol };
  return { supportEnds: cycle.eol, supportEnded: cycle.eol <= today };
}
