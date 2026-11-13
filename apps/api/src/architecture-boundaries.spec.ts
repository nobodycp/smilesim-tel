import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { DEPENDS_ON, MODULES, OWNERS, allowedFor, crossModuleCycles, importEdges, layeringViolations, mutualModules, ownerOf, surfaceViolations, type Edge, type ModuleName, type SourceFile, type Violation } from './architecture-map.fixture';

// The boundaries of the modular monolith (ADR 0020), measured on the source as it is today, wherever a file
// lives. Slice R.0 of the plan `2026-11-13-office-retirement`: it moves nothing; it counts.
//
// The same ratchet as `architecture.spec.ts`: each rule's count is in `architecture.baseline.json`, and may only
// go down. A rule here never names the folder `office`: who owns a file is `architecture-map.fixture.ts`, and
// which file may write what is said by the file's own name, so a file that moves keeps its rule.
//
// Every rule is proved twice: on a made-up case that breaks it (so the rule can fail), and by a count of what it
// looked at in the real source (so it did not pass for looking at nothing).

const SRC = __dirname;
const baseline = JSON.parse(readFileSync(join(SRC, 'architecture.baseline.json'), 'utf8')) as Record<string, number>;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const isTestCode = (file: string) => /\.spec\.ts$|(^|\/)testing\/|\.fixture\.ts$/.test(file);
const production: SourceFile[] = walk(SRC)
  .map((path) => ({ file: relative(SRC, path), text: readFileSync(path, 'utf8') }))
  .filter(({ file }) => !isTestCode(file));
const edges = importEdges(production);

function check(rule: string, found: Violation[]) {
  const allowed = baseline[rule];
  if (allowed === undefined) throw new Error(`architecture.baseline.json has no entry for "${rule}"`);
  const list = found.map((hit) => `  ${hit.file}:${hit.line}  ${hit.text}`).join('\n');
  if (found.length > allowed) throw new Error(`${rule}: ${found.length} violations, baseline ${allowed}. New code broke the rule (ADR 0020):\n${list}`);
  if (found.length < allowed) throw new Error(`${rule}: ${found.length} violations, baseline ${allowed}. Lower the baseline to ${found.length} in this commit.`);
}

/** Every place `pattern` matches in the given files, with the file it is in. */
function sites(files: readonly SourceFile[], pattern: RegExp): Violation[] {
  const found: Violation[] = [];
  for (const { file, text } of files) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (let match = global.exec(text); match; match = global.exec(text)) {
      found.push({ file, line: text.slice(0, match.index).split('\n').length, text: match[0].split('\n')[0].slice(0, 100) });
    }
  }
  return found;
}

/** The sites that are not in a file of one of these names. A file is named, not placed: it may move. */
const outside = (found: readonly Violation[], names: readonly string[]) => found.filter((hit) => !names.includes(basename(hit.file)));

/**
 * A rule about who may write or call something: `pattern` may match only in files named in `owners`. It also
 * proves the rule looked at something: the pattern must match inside the owners, or the rule has gone blind.
 */
function onlyIn(rule: string, pattern: RegExp, owners: readonly string[], files: readonly SourceFile[] = production) {
  const all = sites(files, pattern);
  const stray = outside(all, owners);
  if (all.length === stray.length) throw new Error(`${rule}: the pattern matches nothing in ${owners.join(', ')}. The rule looks at nothing: fix its pattern or its owners.`);
  check(rule, stray);
}

// ── What is written where (the money, the operation, the outbox, the verdict) ───────────────────────────────
const WALLET_ROW_WRITE = /\bwalletEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\b(UPDATE|INSERT INTO|DELETE FROM)\s+"Wallet(Entry)?"/;
const OPERATION_WRITE = /\bproviderOperation\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\b(UPDATE|INSERT INTO|DELETE FROM)\s+"ProviderOperation"/;
const OUTBOX_WRITE = /\boutboxMessage\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\b(UPDATE|INSERT INTO|DELETE FROM)\s+"OutboxMessage"/;
const VERDICT_CALL = /\.(confirmUnknown|declareFailed|resolveUnknown|stampApplied|stampAppliedCorrected|stampHandedOver|recordDecision)\(/;
const HOLD_CALL = /\bledger\.(hold|capture)\(/;
const LINE_CREATED = /\.createLine\(|\bline\.(create|createMany)\(/;
const TRANSACTION = /\$transaction\(/;

describe('the target graph (ADR 0020)', () => {
  it('has no cycle: nothing points upward', () => {
    for (const module of MODULES) {
      for (const lower of DEPENDS_ON[module]) expect({ module, lower, back: allowedFor(lower).has(module) }).toEqual({ module, lower, back: false });
    }
  });

  it('names twelve modules, and every one may use the platform', () => {
    expect(MODULES).toHaveLength(12);
    for (const module of MODULES) expect(allowedFor(module).has('platform')).toBe(true);
  });
});

describe('module boundaries, on the source as it is', () => {
  it('looks at the real source: hundreds of files and imports, and every module owns some', () => {
    expect(production.length).toBeGreaterThan(200);
    expect(edges.length).toBeGreaterThan(800);
    const owned = new Map<string, number>();
    for (const { file } of production) owned.set(ownerOf(file) ?? '?', (owned.get(ownerOf(file) ?? '?') ?? 0) + 1);
    for (const module of [...MODULES, 'app']) expect({ module, files: (owned.get(module) ?? 0) > 0 }).toEqual({ module, files: true });
  });

  it('unmapped-file: every production file has an owner in architecture-map.fixture.ts', () => {
    check('unmapped-file', production.filter(({ file }) => !ownerOf(file)).map(({ file }) => ({ file, line: 1, text: 'no owner' })));
  });

  it('dead-owner-pattern: every line of the map still matches a file', () => {
    // A pattern that matches nothing is a folder that moved without its line: the map would quietly lose it.
    const dead = OWNERS.filter(([pattern]) => !production.some(({ file }) => pattern.test(file)));
    expect(dead.map(([pattern]) => pattern.source)).toEqual([]);
  });

  it('module-layering: a module imports only what is below it', () => {
    check('module-layering', layeringViolations(edges));
  });

  it('module-mutual: no two modules import each other', () => {
    check('module-mutual', mutualModules(edges).map((pair) => ({ file: pair, line: 0, text: 'both ways' })));
  });

  it('file-cycles: no import cycle crosses a module edge', () => {
    check('file-cycles', crossModuleCycles(edges).map((group) => ({ file: group[0], line: 0, text: `${group.length} files in one cycle: ${group.slice(1, 4).join(', ')}${group.length > 4 ? ', …' : ''}` })));
  });

  it('module-surface: a module with a public surface is imported through it', () => {
    // NOT IN FORCE YET. No module has a public surface (an `index.ts` other modules must use): making one is a
    // change to production code, which slice R.0 does not make. A module is added here in the slice that gives
    // it its surface, and from then on a deep import of it is counted. The rule itself is proved below.
    const surfaces: Partial<Record<ModuleName, string>> = {};
    check('module-surface', surfaceViolations(edges, surfaces));
    expect(Object.keys(surfaces)).toEqual([]);
  });

  it('root-domain-code: the source root holds bootstrap and middleware, not domain code', () => {
    const bootstrap = /^(main|app\.module|worker|health\.controller|(door|origin|rate-limit)\.middleware)\.ts$/;
    const rootFiles = production.filter(({ file }) => !file.includes('/') && !bootstrap.test(file));
    const reaching = rootFiles.filter(({ file }) => edges.some((edge) => edge.from === file && edge.to.startsWith('modules/') && ownerOf(edge.to) !== 'platform'));
    check('root-domain-code', reaching.map(({ file }) => ({ file, line: 1, text: 'imports a module that is not the platform' })));
  });
});

describe('who writes the money, the operation and the verdict (ADR 0004, 0017, 0018, 0019)', () => {
  it('wallet-entry-writes: only the wallet ledger writes a ledger entry or a wallet by SQL', () => {
    onlyIn('wallet-entry-writes', WALLET_ROW_WRITE, ['wallet-ledger.ts']);
  });

  it('operation-writes: a provider operation is written by its repository only', () => {
    onlyIn('operation-writes', OPERATION_WRITE, ['provider-operations.repository.ts']);
  });

  it('outbox-writes: an outbox message is written with the operation, or stamped by the relay', () => {
    onlyIn('outbox-writes', OUTBOX_WRITE, ['provider-operations.repository.ts', 'outbox.repository.ts']);
  });

  it('verdict-path: a verdict is acted on, and a decision recorded, by the settlement and the decisions only', () => {
    // Where the methods are defined they are not called with a leading dot, so the definitions are not matched.
    onlyIn('verdict-path', VERDICT_CALL, ['activation-settlement.ts', 'provider-decisions.ts']);
  });

  it('hold-path: a hold is taken by the task and captured by its completion', () => {
    onlyIn('hold-path', HOLD_CALL, ['tasks.service.ts', 'task-completion.ts']);
  });

  it('line-creation: a line is made by the sale or by the completion of its task', () => {
    onlyIn('line-creation', LINE_CREATED, ['lines.service.ts', 'task-completion.ts', 'lines.repository.ts']);
  });

  it('transaction-outside-unit-of-work: a transaction is opened by UnitOfWork.runTx', () => {
    onlyIn('transaction-outside-unit-of-work', TRANSACTION, ['unit-of-work.ts']);
  });
});

// ── The rules can fail: each is run on a made-up case that breaks it ────────────────────────────────────────

const made = (files: Record<string, string>): SourceFile[] => Object.entries(files).map(([file, text]) => ({ file, text }));
const owners = (map: Record<string, string>) => (file: string) => (map[file.split('/')[0]] ?? null) as ReturnType<typeof ownerOf>;

describe('the rules catch what they are for (made-up cases)', () => {
  const byFolder = owners({ wallets: 'wallets', sales: 'sales', tasks: 'tasks', platform: 'platform', boot: 'app' });

  it('reads imports: plain, type-only, re-exports, side-effect and dynamic; and ignores packages', () => {
    const found = importEdges(made({
      'sales/a.ts': "import { x } from '../wallets/ledger';\nimport type { T } from '../tasks/t';\nexport { y } from '../platform/y';\nimport '../platform/side';\nconst later = import('../tasks/lazy');\nimport { Injectable } from '@nestjs/common';",
      'wallets/ledger.ts': '', 'tasks/t.ts': '', 'platform/y.ts': '', 'platform/side.ts': '', 'tasks/lazy.ts': '',
    }));
    expect(found.map((edge) => `${edge.to}${edge.typeOnly ? ' (type)' : ''}`).sort()).toEqual(['platform/side.ts', 'platform/y.ts', 'tasks/lazy.ts', 'tasks/t.ts (type)', 'wallets/ledger.ts']);
  });

  it('layering: an import upward is a violation, one downward is not, and nothing imports a composition root', () => {
    const cases = importEdges(made({
      'wallets/ledger.ts': "import { complete } from '../sales/completion';\nimport { boot } from '../boot/main';\nimport { tx } from '../platform/uow';",
      'sales/completion.ts': "import { ledger } from '../wallets/ledger';",
      'boot/main.ts': "import { complete } from '../sales/completion';",
      'platform/uow.ts': '',
    }));
    expect(layeringViolations(cases, byFolder).map((hit) => hit.text)).toEqual(['wallets -> sales  (sales/completion.ts)', 'wallets -> app  (boot/main.ts)']);
  });

  it('layering: a type-only import upward is still a violation', () => {
    const cases = importEdges(made({ 'tasks/t.ts': "import type { Line } from '../sales/line';", 'sales/line.ts': '' }));
    expect(layeringViolations(cases, byFolder)).toHaveLength(1);
  });

  it('mutual: two modules that import each other are one pair, whatever the number of imports', () => {
    const cases = importEdges(made({
      'tasks/a.ts': "import { x } from '../sales/b';\nimport { y } from '../sales/c';",
      'sales/b.ts': "import { z } from '../tasks/a';", 'sales/c.ts': '',
      'wallets/w.ts': "import { p } from '../platform/p';", 'platform/p.ts': '',
    }));
    expect(mutualModules(cases, byFolder)).toEqual(['sales <-> tasks']);
  });

  it('cycles: a cycle through three files of two modules is found; one inside a module is not; a type-only one is not', () => {
    const cross = importEdges(made({
      'tasks/a.ts': "import { b } from '../sales/b';", 'sales/b.ts': "import { c } from './c';", 'sales/c.ts': "import { a } from '../tasks/a';",
    }));
    expect(crossModuleCycles(cross, byFolder)).toEqual([['sales/b.ts', 'sales/c.ts', 'tasks/a.ts']]);
    const inside = importEdges(made({ 'sales/b.ts': "import { c } from './c';", 'sales/c.ts': "import { b } from './b';" }));
    expect(crossModuleCycles(inside, byFolder)).toEqual([]);
    const typed = importEdges(made({ 'tasks/a.ts': "import type { B } from '../sales/b';", 'sales/b.ts': "import { a } from '../tasks/a';" }));
    expect(crossModuleCycles(typed, byFolder)).toEqual([]);
  });

  it('surface: once a module has a surface, a deep import of it is a violation and its surface is not', () => {
    const cases: Edge[] = importEdges(made({
      'sales/a.ts': "import { ledger } from '../wallets/wallet-ledger';\nimport { Wallets } from '../wallets/index';",
      'wallets/wallet-ledger.ts': '', 'wallets/index.ts': "export { ledger } from './wallet-ledger';",
    }));
    expect(surfaceViolations(cases, {}, byFolder)).toEqual([]);
    expect(surfaceViolations(cases, { wallets: 'wallets/index.ts' }, byFolder).map((hit) => hit.file)).toEqual(['sales/a.ts']);
  });

  it('unmapped: a file in a folder the map does not know has no owner', () => {
    expect(ownerOf('modules/billing/invoices.service.ts')).toBeNull();
    expect(ownerOf('modules/office/wallets/wallet-ledger.ts')).toBe('wallets');
  });

  it.each([
    ['a ledger entry written by a service', WALLET_ROW_WRITE, 'await tx.walletEntry.create({ data });', ['wallet-ledger.ts']],
    ['a wallet changed by SQL in a report', WALLET_ROW_WRITE, 'await tx.$executeRaw`UPDATE "Wallet" SET balance = 0`;', ['wallet-ledger.ts']],
    ['an operation moved outside its repository', OPERATION_WRITE, "await tx.providerOperation.updateMany({ where: { id }, data: { status: 'failed' } });", ['provider-operations.repository.ts']],
    ['an outbox message written by a service', OUTBOX_WRITE, 'await tx.outboxMessage.create({ data });', ['provider-operations.repository.ts', 'outbox.repository.ts']],
    ['an unknown operation closed from a controller', VERDICT_CALL, 'await this.operations.declareFailed(tx, id);', ['activation-settlement.ts', 'provider-decisions.ts']],
    ['a hold captured outside the completion', HOLD_CALL, 'await this.ledger.capture(tx, posId, held, amount, actorId, kind, note);', ['tasks.service.ts', 'task-completion.ts']],
    ['a line made by a report', LINE_CREATED, 'await this.repo.createLine(tx, data);', ['lines.service.ts', 'task-completion.ts', 'lines.repository.ts']],
    ['a transaction opened beside the unit of work', TRANSACTION, 'await this.prisma.$transaction(async (tx) => {});', ['unit-of-work.ts']],
  ] as const)('who-writes: %s is a stray site, and the same line in its owner is not', (_what, pattern, line, owner) => {
    const stray = sites(made({ 'modules/anything/moved/somewhere.service.ts': line }), pattern);
    expect(outside(stray, owner)).toHaveLength(1);
    const owned = sites(made({ [`modules/anywhere/it/moves/${owner[0]}`]: line }), pattern);
    expect(owned).toHaveLength(1);
    expect(outside(owned, owner)).toHaveLength(0);
  });

  it('a who-writes rule that matches nothing in its owners fails instead of passing', () => {
    expect(() => onlyIn('wallet-entry-writes', WALLET_ROW_WRITE, ['wallet-ledger.ts'], made({ 'modules/x/y.ts': 'nothing here' }))).toThrow(/looks at nothing/);
  });
});
