import type { SystemVersions, VersionBehind, VersionCycle, VersionItem } from '../../lib/api-types';

// The versions page's rules on the web side (spec 2026-11-17-system-monitor, section 5): the same reading,
// comparing and cycle rule the API applies to its own components (apps/api/src/modules/monitoring/versions.rules.ts,
// written out in the comments of `VersionBehind` and `VersionItem` in lib/api-types.ts), so the web's own components
// are judged exactly as the API judges the rest. Pure: no React, no Node, no clock but the day handed in. Not
// imported from the API: the web never builds against the API's source.

/** A version read: its numbers as written (one to three), and whether it carries a pre-release tag. */
type Parsed = { parts: number[]; pre: boolean };

/**
 * Reads `v24.21.0`, `17.6`, `7.4.1`, `19.0.0-rc.1`, `19beta1`, `17.6 (Debian …)`: a `v` and spaces before are
 * dropped, then up to three numbers; a tag right after them (`-rc.1`, `beta1`) is a pre-release, a build (`+…`) or
 * anything after a space is ignored. Null when it starts with no number.
 */
function parseVersion(text: string | null | undefined): Parsed | null {
  if (typeof text !== 'string') return null;
  const found = /^\s*[vV]?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(.*)$/s.exec(text);
  if (!found) return null;
  const parts = [found[1], found[2], found[3]].filter((part): part is string => part !== undefined).map(Number);
  return { parts, pre: /^(?:-|[A-Za-z])/.test(found[4]) };
}

/** The numbers and tag of a version, without what follows them: `17.6 (Debian …)` → `17.6`. Null when unreadable. */
function plainVersion(text: string | null | undefined): string | null {
  const found = typeof text === 'string' ? /^\s*([vV]?\d{1,9}(?:\.\d{1,9}){0,2}(?:-[0-9A-Za-z.-]{1,40}|[A-Za-z][0-9A-Za-z.]{0,40})?)/.exec(text) : null;
  return found ? found[1] : null;
}

/** Two versions as three numbers each; two-number versions on both sides (PostgreSQL's `17.6`) are major and patch. */
function aligned(a: Parsed, b: Parsed): [number[], number[]] {
  const twoPart = a.parts.length <= 2 && b.parts.length <= 2;
  const three = (parts: number[]) => (twoPart ? [parts[0], 0, parts[1] ?? 0] : [parts[0], parts[1] ?? 0, parts[2] ?? 0]);
  return [three(a.parts), three(b.parts)];
}

/** Negative when `a` is older, positive when newer, 0 when the same; a pre-release is older than its release. */
function compareVersions(a: Parsed, b: Parsed): number {
  const [x, y] = aligned(a, b);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return Number(b.pre) - Number(a.pre);
}

/**
 * How far `current` is behind `latest`: `none` when the same or newer, else the first number that differs
 * (`major`, `minor`, `patch`; a pre-release of the newest numbers is `patch`); `unknown` when either is unreadable.
 */
export function behindOf(current: string | null | undefined, latest: string | null | undefined): VersionBehind {
  const left = parseVersion(current);
  const right = parseVersion(latest);
  if (!left || !right) return 'unknown';
  if (compareVersions(left, right) >= 0) return 'none';
  const [x, y] = aligned(left, right);
  if (x[0] !== y[0]) return 'major';
  if (x[1] !== y[1]) return 'minor';
  return 'patch';
}

/** The cycle a version belongs to: the longest cycle name that is the version or starts it before a dot. */
export function cycleOf(version: string | null | undefined, cycles: VersionCycle[]): VersionCycle | null {
  const plain = plainVersion(version)?.replace(/^[vV]/, '');
  if (!plain) return null;
  const matching = cycles.filter((cycle) => plain === cycle.cycle || plain.startsWith(`${cycle.cycle}.`));
  return matching.sort((a, b) => b.cycle.length - a.cycle.length)[0] ?? null;
}

/** When a cycle's support ends (a date, or null when undated), and whether it already has on `today` (`YYYY-MM-DD`). */
function supportOf(cycle: VersionCycle | null, today: string): { supportEnds: string | null; supportEnded: boolean } {
  if (!cycle) return { supportEnds: null, supportEnded: false };
  if (typeof cycle.eol === 'boolean') return { supportEnds: null, supportEnded: cycle.eol };
  return { supportEnds: cycle.eol, supportEnded: cycle.eol <= today };
}

/**
 * The name of the cycle a runtime in use belongs to, for «أحدث ضمن الإصدار 24». From its `cycles` when the item
 * carries them (the web's Node.js); otherwise from the version itself, as endoflife.date names the cycles of the
 * runtimes the system lists: Redis by its first two numbers (`7.4`), Node.js and PostgreSQL by the first (`24`, `17`).
 */
export function cycleName(item: VersionItem): string | null {
  const fromCycles = item.cycles.length > 0 ? cycleOf(item.current, item.cycles) : null;
  if (fromCycles) return fromCycles.cycle;
  const parsed = parseVersion(item.current);
  if (!parsed) return null;
  return item.name === 'redis' && parsed.parts.length > 1 ? parsed.parts.slice(0, 2).join('.') : String(parsed.parts[0]);
}

/** What the web server runs: its Node.js and the installed version of each of its libraries, by npm name. */
export type WebVersions = { nodejs: string | null; libraries: Record<string, string | null> };

/**
 * The API's answer with the web's own components filled in: `current` from what the web server read, then `behind`
 * against the newest, and for a runtime its cycle in use (`latestInCycle`, `supportEnds`, `supportEnded`) found in
 * the item's `cycles`, as the API works out its own. Every other item is left as the API sent it.
 */
export function withWebVersions(page: SystemVersions, web: WebVersions, today: string): SystemVersions {
  return {
    ...page,
    items: page.items.map((item) => {
      if (item.where !== 'web') return item;
      const current = item.kind === 'runtime' ? (item.name === 'nodejs' ? web.nodejs : null) : (web.libraries[item.name] ?? null);
      const cycle = item.kind === 'runtime' ? cycleOf(current, item.cycles) : null;
      return {
        ...item,
        current,
        latestInCycle: cycle?.latest ?? null,
        behind: behindOf(current, item.latest),
        ...supportOf(cycle, today),
      };
    }),
  };
}
