import { dirname, join, normalize } from 'node:path';

// The target modules of the modular monolith (ADR 0020) and which of them owns each production file TODAY,
// wherever the file lives. The boundary rules (`architecture-boundaries.spec.ts`) measure the present code
// against the target with this map, so a rule does not depend on a folder named `office`: a file that moves
// keeps its owner by changing one line here, and a file no line here covers fails `unmapped-file`.
//
// Test-only (`*.fixture.ts`): the build leaves it out.

export const MODULES = ['platform', 'identity', 'auditing', 'notifications', 'access', 'catalog', 'pricing', 'wallets', 'providers', 'tasks', 'sales', 'reporting'] as const;
export type ModuleName = (typeof MODULES)[number];
/** `app`: the composition roots (bootstrap, middleware, the worker's start). It may import any module; no module imports it. */
export type Owner = ModuleName | 'app';

/**
 * What each module may import directly. The closure of this graph is what is allowed: a module may use anything
 * reachable below it. Every module may use `platform`. Nothing points upward, so the graph has no cycle
 * (`the target graph has no cycle` proves it).
 */
export const DEPENDS_ON: Record<ModuleName, readonly ModuleName[]> = {
  platform: [],
  // Slice R.2: the activity log is recorded through a port of the platform (`shared/activity.ts`) and notices are
  // written through another (`shared/notices.ts`). So sign-in and the account tree import neither, and the two
  // modules that implement the ports sit above what they read: auditing reads sessions (identity) and, for the
  // audit page, the actor and the tree (access); notifications reads the actor for the inbox and the stream.
  identity: ['platform'],
  access: ['identity', 'platform'],
  auditing: ['access', 'identity', 'platform'],
  notifications: ['access', 'platform'],
  catalog: ['access', 'platform'],
  pricing: ['catalog', 'access', 'platform'],
  wallets: ['pricing', 'platform'],
  providers: ['wallets', 'catalog', 'notifications', 'platform'],
  tasks: ['wallets', 'notifications', 'access', 'platform'],
  sales: ['tasks', 'providers', 'pricing', 'wallets', 'catalog', 'platform'],
  reporting: ['sales', 'tasks', 'providers', 'wallets', 'platform'],
};

/** First match wins. Paths are relative to `apps/api/src`. */
export const OWNERS: readonly [pattern: RegExp, owner: Owner][] = [
  // ── composition roots ─────────────────────────────────────────────────────────────────────────────
  [/^(main|app\.module|worker|health\.controller)\.ts$/, 'app'],
  [/^(door|origin|rate-limit)\.middleware\.ts$/, 'app'],
  [/^openapi\/setup\.ts$/, 'app'],
  [/^modules\/registry\.ts$/, 'app'],
  [/^modules\/office\/office\.module\.ts$/, 'app'],
  // Domain code at the root (audit finding H2, L1): composition roots for now, counted by `root-domain-code`.
  [/^(provider-dispatch|reservation-conflicts|seal-esim-codes|seal-secrets|two-factor-methods)\.ts$/, 'app'],
  // ── platform ──────────────────────────────────────────────────────────────────────────────────────
  [/^(config|errors|db|doors|cors|security-headers|production-config)\.ts$/, 'platform'],
  [/^openapi\//, 'platform'],
  [/^modules\/shared\//, 'platform'],
  [/^modules\/office\/outbox\//, 'platform'],
  [/^modules\/office\/kernel\/(unit-of-work|query|values)\.ts$/, 'platform'],
  [/^modules\/office\/rules\/office-paging\.ts$/, 'platform'],
  // ── identity, auditing, notifications ─────────────────────────────────────────────────────────────
  [/^modules\/auth\//, 'identity'],
  // The log's writer (the port's implementation) and its reading; notices, with the port's implementation.
  [/^modules\/auditing\//, 'auditing'],
  [/^modules\/notifications\//, 'notifications'],
  // ── access (the actor, grants, roles, the account tree, accounts) ────────────────────────────────
  [/^modules\/office\/kernel\/(line-terms)\.ts$/, 'pricing'],
  [/^modules\/office\/kernel\/sale\.ts$/, 'wallets'],
  [/^modules\/office\/kernel\//, 'access'],
  [/^modules\/office\/policy\.ts$/, 'access'],
  [/^modules\/office\/(accounts|roles)\//, 'access'],
  [/^modules\/office\/rules\/(office-grants|account-visibility)\.ts$/, 'access'],
  // ── catalog, pricing ──────────────────────────────────────────────────────────────────────────────
  [/^modules\/branding\//, 'catalog'],
  [/^modules\/office\/(catalog|companies|packages|offers)\//, 'catalog'],
  [/^modules\/office\/rules\/(run-modes|sim-rules|package-code)\.ts$/, 'catalog'],
  [/^modules\/office\/terms\//, 'pricing'],
  [/^modules\/office\/rules\/(prices|line-prices|user-terms|office-terms|profit-ladder)\.ts$/, 'pricing'],
  // ── wallets, providers, tasks, sales, reporting ───────────────────────────────────────────────────
  [/^modules\/office\/wallets\//, 'wallets'],
  [/^modules\/office\/providers\//, 'providers'],
  [/^modules\/office\/tasks\//, 'tasks'],
  [/^modules\/office\/stored-text\.ts$/, 'tasks'],
  [/^modules\/office\/(lines|transfers)\//, 'sales'],
  [/^modules\/office\/rules\/periods\.ts$/, 'sales'],
  [/^modules\/office\/(reports|desk)\//, 'reporting'],
];

export function ownerOf(file: string): Owner | null {
  return OWNERS.find(([pattern]) => pattern.test(file))?.[1] ?? null;
}

/** Everything `module` may import: itself, and all that is reachable below it. */
export function allowedFor(module: ModuleName, graph: Record<string, readonly string[]> = DEPENDS_ON): Set<string> {
  const seen = new Set<string>([module]);
  const visit = (name: string) => {
    for (const next of graph[name] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        visit(next);
      }
    }
  };
  visit(module);
  return seen;
}

export type SourceFile = { file: string; text: string };
export type Edge = { from: string; to: string; line: number; typeOnly: boolean };

/** Every relative import of the given files that lands on another of them (`x`, `x.ts` or `x/index.ts`). */
export function importEdges(files: readonly SourceFile[]): Edge[] {
  const known = new Set(files.map(({ file }) => file));
  const edges: Edge[] = [];
  for (const { file, text } of files) {
    const statement = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"`;]*?from\s+'(\.[^']+)'|(?:^|\n)\s*import\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'\s*\)/g;
    for (let match = statement.exec(text); match; match = statement.exec(text)) {
      const target = normalize(join(dirname(file), match[2] ?? match[3] ?? match[4]));
      const to = [`${target}.ts`, join(target, 'index.ts'), target].find((candidate) => known.has(candidate));
      if (to) edges.push({ from: file, to, line: text.slice(0, match.index).split('\n').length + 1, typeOnly: Boolean(match[1]) });
    }
  }
  return edges;
}

export type Violation = { file: string; line: number; text: string };

/** Imports the target graph does not allow: from a module to one that is not below it, or from any module to `app`. */
export function layeringViolations(edges: readonly Edge[], owner: (file: string) => Owner | null = ownerOf, graph: Record<string, readonly string[]> = DEPENDS_ON): Violation[] {
  const found: Violation[] = [];
  for (const edge of edges) {
    const from = owner(edge.from);
    const to = owner(edge.to);
    if (!from || !to || from === to || from === 'app') continue;
    if (to === 'app' || !allowedFor(from as ModuleName, graph).has(to)) found.push({ file: edge.from, line: edge.line, text: `${from} -> ${to}  (${edge.to})` });
  }
  return found;
}

/** Pairs of modules that import each other, each pair once (`a <-> b`, names sorted). */
export function mutualModules(edges: readonly Edge[], owner: (file: string) => Owner | null = ownerOf): string[] {
  const seen = new Set<string>();
  for (const edge of edges) {
    const from = owner(edge.from);
    const to = owner(edge.to);
    if (from && to && from !== to && from !== 'app' && to !== 'app') seen.add(`${from}>${to}`);
  }
  const pairs = new Set<string>();
  for (const key of seen) {
    const [from, to] = key.split('>');
    if (seen.has(`${to}>${from}`)) pairs.add([from, to].sort().join(' <-> '));
  }
  return [...pairs].sort();
}

/**
 * Import cycles between files that cross a module's edge: the strongly connected groups of the file graph
 * (Tarjan) that hold files of two modules or more. Type-only imports are left out here: they vanish when the
 * code is compiled, so they make no cycle at run time (`module-layering` still counts them).
 */
export function crossModuleCycles(edges: readonly Edge[], owner: (file: string) => Owner | null = ownerOf): string[][] {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.typeOnly) continue;
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    if (!next.has(edge.to)) next.set(edge.to, []);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;
  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of next.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node) as number, low.get(target) as number));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node) as number, index.get(target) as number));
      }
    }
    if (low.get(node) === index.get(node)) {
      const group: string[] = [];
      for (let member = stack.pop() as string; ; member = stack.pop() as string) {
        onStack.delete(member);
        group.push(member);
        if (member === node) break;
      }
      if (group.length > 1 && new Set(group.map((file) => owner(file))).size > 1) groups.push(group.sort());
    }
  };
  for (const node of next.keys()) if (!index.has(node)) visit(node);
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Imports that reach inside a module that has a public surface. `surfaces` maps a module to the file other
 * modules must import it through; a module with no entry has no surface yet and is not judged.
 */
export function surfaceViolations(edges: readonly Edge[], surfaces: Partial<Record<ModuleName, string>>, owner: (file: string) => Owner | null = ownerOf): Violation[] {
  const found: Violation[] = [];
  for (const edge of edges) {
    const from = owner(edge.from);
    const to = owner(edge.to);
    if (!from || !to || from === to || to === 'app') continue;
    const surface = surfaces[to as ModuleName];
    if (surface && edge.to !== surface) found.push({ file: edge.from, line: edge.line, text: `${edge.to} is inside ${to}: import ${surface}` });
  }
  return found;
}
