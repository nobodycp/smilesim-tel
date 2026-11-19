import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REFUND_KINDS, SALE_KINDS } from './modules/pricing';
import { PROVIDER_OPERATION_KINDS } from './modules/wallets/provider-cost';
import { POSTPAID_KINDS, MONEY_KINDS, MOVES_NO_PROFIT, OFF_THE_STATEMENT, isLineKind } from './modules/wallets/entry-kinds';
import { WALLET_ENTRY_KINDS } from './modules/wallets/wallets.schemas';

// Guards on the wallet-entry kind lists (spec 2026-11-19 business-lines foundation, F.4; ADR 0028, decision 5), so a
// kind added tomorrow cannot be half-added. Read from the source as it is: the migrations' SQL, the code's lists, the
// web's names. Every rule is proved on a made-up case that breaks it, and by a count of what it looked at.

const SRC = __dirname;
const MIGRATIONS = join(SRC, '..', 'prisma', 'migrations');
const WEB = join(SRC, '..', '..', 'web');

const sorted = (list: Iterable<string>) => [...new Set(list)].sort();

// --- The SQL of the index and the CHECKs, from the latest migration that defines each ---------------------------

/** The latest migration's statement that defines `name` (a CREATE INDEX or an ADD CONSTRAINT), up to its `;`. */
function latestDefinition(name: string, files = migrationFiles()): string {
  const opening = new RegExp(`(CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"${name}"|ADD\\s+CONSTRAINT\\s+"${name}")`);
  for (const file of [...files].reverse()) {
    const sql = file.sql.replace(/--[^\n]*/g, '');
    const at = sql.search(opening);
    if (at >= 0) return sql.slice(at, sql.indexOf(';', at) + 1);
  }
  throw new Error(`no migration defines "${name}"`);
}

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => statSync(join(MIGRATIONS, name)).isDirectory())
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8') }));
}

const quoted = (text: string) => [...text.matchAll(/'([^']*)'/g)].map((match) => match[1]);

/** The kinds a predicate names with the sign of the amount beside them: `"kind" IN (…) AND "amount" < 0`. */
function kindsBySign(sql: string): { out: string[]; in: string[] } {
  const found = { out: [] as string[], in: [] as string[] };
  for (const match of sql.matchAll(/"kind"\s*(?:IN\s*\(([^)]*)\)|=\s*('[^']*'))\s*AND\s*"amount"\s*([<>])\s*0/g)) {
    (match[3] === '<' ? found.out : found.in).push(...quoted(match[1] ?? match[2]));
  }
  return { out: sorted(found.out), in: sorted(found.in) };
}

/** The kinds of a `"kind" NOT IN (…)`. */
const kindsNotIn = (sql: string) => sorted(quoted(/"kind"\s+NOT\s+IN\s*\(([^)]*)\)/.exec(sql)?.[1] ?? ''));

describe('the kinds in the database\'s SQL are the code\'s lists', () => {
  it('the partial index of the sales and refunds: SALE_KINDS moving money out, REFUND_KINDS moving it in', () => {
    const sql = latestDefinition('WalletEntry_sale_or_refund_createdAt_id');
    expect(kindsBySign(sql)).toEqual({ out: sorted(Object.keys(SALE_KINDS)), in: sorted(REFUND_KINDS) });
  });

  it('the CHECK `WalletEntry_operation_priced`: PROVIDER_OPERATION_KINDS', () => {
    expect(kindsNotIn(latestDefinition('WalletEntry_operation_priced'))).toEqual(sorted(PROVIDER_OPERATION_KINDS));
  });

  it('the CHECK `WalletEntry_sale_has_ladder` (F.3): SALE_KINDS moving money out', () => {
    expect(kindsBySign(latestDefinition('WalletEntry_sale_has_ladder'))).toEqual({ out: sorted(Object.keys(SALE_KINDS)), in: [] });
  });

  it('reads the latest definition, and would catch a list that drifted', () => {
    const files = [
      { name: '1_old', sql: `CREATE INDEX "x" ON "WalletEntry" ("createdAt") WHERE ("kind" IN ('activate') AND "amount" < 0);` },
      { name: '2_new', sql: `-- "kind" IN ('ignored') AND "amount" < 0\nDROP INDEX "x";\nCREATE INDEX CONCURRENTLY "x" ON "WalletEntry" ("createdAt") WHERE ("kind" IN ('activate', 'charge') AND "amount" < 0) OR ("kind" = 'disconnect' AND "amount" > 0);` },
    ];
    expect(kindsBySign(latestDefinition('x', files))).toEqual({ out: ['activate', 'charge'], in: ['disconnect'] });
    expect(kindsBySign(latestDefinition('x', files)).out).not.toEqual(sorted(Object.keys(SALE_KINDS)));
    expect(() => latestDefinition('nowhere', files)).toThrow(/no migration defines/);
  });
});

// --- Every kind the API writes: listed, named on the web, counted or named as moving no profit ------------------

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path, keep) : keep(path) ? [path] : [];
  });
}

const isTestCode = (file: string) => /\.spec\.ts$|(^|\/)testing\/|\.fixture\.ts$/.test(file);
const production = walk(SRC, (path) => path.endsWith('.ts'))
  .map((path) => ({ file: relative(SRC, path), text: readFileSync(path, 'utf8') }))
  .filter(({ file }) => !isTestCode(file));

/**
 * The kinds the source writes as literals: the kind argument of a ledger call (`move`, `capture`, `recordOp`) on one
 * line, and the `kind:` of an entry the ledger creates itself (a hold, a release, a given-back activation). A task's
 * own action becomes its entry's kind (`task.action`): those are the task actions, read from their list.
 */
function writtenKinds(files: { file: string; text: string }[]): Set<string> {
  const kinds = new Set<string>();
  for (const { file, text } of files) {
    for (const line of text.split('\n')) {
      const call = /\.(?:move|capture|recordOp)\((.*)$/.exec(line);
      if (call) for (const word of quoted(call[1])) if (/^[a-z][a-z_.-]*$/.test(word)) kinds.add(word);
      // An entry's data names its amount on the same line; a notice's `kind` (`wallet.negative`) does not.
      if (file.endsWith('wallet-ledger.ts') && /\bamount\b/.test(line)) for (const match of line.matchAll(/kind:\s*'([a-z_.]+)'/g)) kinds.add(match[1]);
    }
  }
  const actions = /const TASK_ACTIONS = \[([^\]]*)\]/.exec(files.find(({ file }) => file.endsWith('tasks/tasks.schemas.ts'))?.text ?? '');
  for (const word of quoted(actions?.[1] ?? '')) kinds.add(word);
  return kinds;
}

/** The copy key the web shows for a kind: `movementName` first (finance-screen.tsx), then `actionName` (names.ts). */
function webNames(): Map<string, string> {
  const names = new Map<string, string>();
  const read = (path: string, variable: string) => {
    for (const match of readFileSync(join(WEB, path), 'utf8').matchAll(new RegExp(`if \\(${variable} === '([a-z_.]+)'\\) return t\\.(\\w+);`, 'g'))) {
      if (!names.has(match[1])) names.set(match[1], match[2]);
    }
  };
  read('features/wallets/screens/finance-screen.tsx', 'kind');
  read('components/names.ts', 'action');
  return names;
}

const copyKeys = (language: string) => new Set([...readFileSync(join(WEB, 'lib', 'copy', `${language}.ts`), 'utf8').matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]));

describe('every kind the API can write is whole', () => {
  const written = writtenKinds(production);

  it('is in WALLET_ENTRY_KINDS (what the filters accept), which is the postpaid line\'s words and the shared money words', () => {
    expect(written.size).toBeGreaterThanOrEqual(15);
    expect(sorted(written).filter((kind) => !(WALLET_ENTRY_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(sorted(WALLET_ENTRY_KINDS)).toEqual(sorted([...POSTPAID_KINDS, ...MONEY_KINDS]));
  });

  it('has a name in the web\'s copy, in Arabic, English and Hebrew', () => {
    const names = webNames();
    const languages = ['ar', 'en', 'he'].map((language) => ({ language, keys: copyKeys(language) }));
    const missing = WALLET_ENTRY_KINDS.flatMap((kind) => {
      const key = names.get(kind);
      if (!key) return [`${kind}: no name in movementName or actionName`];
      return languages.filter(({ keys }) => !keys.has(key)).map(({ language }) => `${kind}: t.${key} missing in ${language}`);
    });
    expect(missing).toEqual([]);
    expect(names.size).toBeGreaterThan(WALLET_ENTRY_KINDS.length);
  });

  it('is in a sum\'s allow-list or named as moving no profit, never both', () => {
    const summed = new Set([...Object.keys(SALE_KINDS), ...REFUND_KINDS, ...PROVIDER_OPERATION_KINDS]);
    const placed = (kind: string) => summed.has(kind) !== MOVES_NO_PROFIT.includes(kind);
    expect(WALLET_ENTRY_KINDS.filter((kind) => !placed(kind))).toEqual([]);
    // It would catch a kind in neither, and one in both.
    expect(placed('prepaid.topup')).toBe(false);
    expect([...summed].filter((kind) => MOVES_NO_PROFIT.includes(kind))).toEqual([]);
  });

  it('finds the kinds the source writes, and would catch one that is not listed', () => {
    const made = writtenKinds([{ file: 'x.ts', text: `await this.ledger.move(tx, id, -1, actor, 'games.uc', '', sale);` }]);
    expect(made.has('games.uc')).toBe(true);
    expect((WALLET_ENTRY_KINDS as readonly string[]).includes('games.uc')).toBe(false);
  });
});

// --- No query filters WalletEntry.kind by exclusion but the statement of F.2 -------------------------------------

/** The places that filter a kind by exclusion: `notIn`, `kind: { not: … }`, or `"kind" NOT IN` outside a CHECK. */
function exclusions(files: { file: string; text: string }[]): string[] {
  return files.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, at) => {
      const excludes = /\bkind\b[^\n]*\bnotIn\b|\bkind:\s*\{\s*not\b|"kind"\s+NOT\s+IN/.test(line) || (/\bnotIn\b/.test(line) && /OFF_THE_STATEMENT|kind/i.test(line));
      return excludes && !/\bCHECK\b/.test(line) ? [`${file}:${at + 1}`] : [];
    }),
  );
}

describe('a statement lists by exclusion; nothing else does', () => {
  it('only the wallet page (`WalletsService.ledger`, OFF_THE_STATEMENT) filters the kind by exclusion', () => {
    const found = exclusions(production);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^modules\/wallets\/wallets\.service\.ts:\d+$/);
    expect(production.find(({ file }) => file === 'modules/wallets/wallets.service.ts')?.text).toContain('kind: kind || { notIn: [...OFF_THE_STATEMENT] }');
    expect(OFF_THE_STATEMENT).toEqual(['hold', 'release']);
    expect(production.length).toBeGreaterThan(100);
  });

  it('would catch a sum that excluded kinds', () => {
    expect(exclusions([{ file: 'x.ts', text: "where: { kind: { notIn: ['fund'] } }" }])).toEqual(['x.ts:1']);
    expect(exclusions([{ file: 'y.ts', text: 'WHERE "kind" NOT IN (\'fund\')' }])).toEqual(['y.ts:1']);
    expect(exclusions([{ file: 'z.ts', text: 'ADD CONSTRAINT "c" CHECK ("kind" NOT IN (\'a\') OR true)' }])).toEqual([]);
  });
});

// --- The reserved words (ADR 0028, decision 5) ---------------------------------------------------------------------

describe('the words are reserved', () => {
  it('names the postpaid line\'s bare kinds of ADR 0028; a bare kind that is in no list is refused', () => {
    expect(sorted(POSTPAID_KINDS)).toEqual(sorted(['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'switch', 'esim', 'sim', 'refresh', 'transfer', 'rename', 'freeze', 'unfreeze', 'addon']));
    const bare = WALLET_ENTRY_KINDS.filter((kind) => !isLineKind(kind));
    expect(bare.filter((kind) => !POSTPAID_KINDS.includes(kind) && !MONEY_KINDS.includes(kind))).toEqual([]);
  });

  it('tells a new line\'s kind by its prefix and dot', () => {
    expect(isLineKind('prepaid.topup')).toBe(true);
    expect(isLineKind('travel-esim.issue')).toBe(true);
    expect(isLineKind('esim')).toBe(false);
    expect(isLineKind('.topup')).toBe(false);
    // A new line's kind never takes a bare word of postpaid or of money as its prefix.
    const prefixOf = (kind: string) => kind.split('.')[0];
    expect(WALLET_ENTRY_KINDS.filter(isLineKind).filter((kind) => [...POSTPAID_KINDS, ...MONEY_KINDS].includes(prefixOf(kind)))).toEqual([]);
  });
});
