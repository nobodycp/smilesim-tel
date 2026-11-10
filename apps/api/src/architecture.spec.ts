import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The engineering rules of `.cursor/rules/backend-engineering.mdc`, checked on the source itself.
// Each rule counts its violations and compares with `architecture.baseline.json`. The count may only go down:
// more than the baseline fails (a new violation); fewer fails too, until the baseline is lowered in the same commit.

const SRC = __dirname;
const baseline = JSON.parse(readFileSync(join(SRC, 'architecture.baseline.json'), 'utf8')) as Record<string, number>;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const isTestCode = (file: string) =>
  /\.spec\.ts$|\/testing\/|\.fixture\.ts$/.test(file) || file === 'architecture.spec.ts';

const files = walk(SRC).map((path) => ({ file: relative(SRC, path), text: readFileSync(path, 'utf8') }));
const production = files.filter(({ file }) => !isTestCode(file));

type Hit = { file: string; line: number; text: string };

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Every match of `pattern` in the given files, optionally kept only when `keep` says so. */
function hits(set: typeof files, pattern: RegExp, keep: (match: RegExpExecArray, text: string, file: string) => boolean = () => true): Hit[] {
  const found: Hit[] = [];
  for (const { file, text } of set) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (let match = global.exec(text); match; match = global.exec(text)) {
      if (keep(match, text, file)) found.push({ file, line: lineOf(text, match.index), text: match[0].split('\n')[0].slice(0, 100) });
    }
  }
  return found;
}

/** The text of the block that opens at the first `{` at or after `from`, by brace counting. */
function blockAt(text: string, from: number): string {
  const start = text.indexOf('{', from);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function check(rule: string, found: Hit[]) {
  const allowed = baseline[rule];
  if (allowed === undefined) throw new Error(`architecture.baseline.json has no entry for "${rule}"`);
  const list = found.map((hit) => `  ${hit.file}:${hit.line}  ${hit.text}`).join('\n');
  if (found.length > allowed) {
    throw new Error(`${rule}: ${found.length} violations, baseline ${allowed}. New code broke the rule (backend-engineering.mdc):\n${list}`);
  }
  if (found.length < allowed) {
    throw new Error(`${rule}: ${found.length} violations, baseline ${allowed}. Lower the baseline to ${found.length} in this commit.`);
  }
}

const within = (prefix: string) => production.filter(({ file }) => file.startsWith(prefix));
const office = within('modules/office/');
const officeControllers = office.filter(({ file }) => file.endsWith('.controller.ts'));

describe('engineering rules (backend-engineering.mdc)', () => {
  it('1.2 wallet-writes: only the wallet ledger writes a wallet row', () => {
    const allowed = ['modules/office/wallets/wallet-ledger.ts', 'modules/office/catalog/catalog-seed.ts'];
    check('wallet-writes', hits(production, /\bwallet\.(update|updateMany|upsert|create|delete)\(/, (match, text, file) => {
      if (allowed.some((prefix) => file.startsWith(prefix))) return false;
      // The credit ceiling is a setting, not money: `wallets.service.ts` may write it.
      return !/data:\s*\{\s*ceiling\b/.test(text.slice(match.index, match.index + 200));
    }));
  });

  it('1.1 multi-write-outside-tx: writes that belong together run in one transaction', () => {
    // A service method that awaits two or more repository writes one after the other and never opens `runTx`: a
    // failure between them leaves half a change (the account delete, plan backend-loose-ends A.1). Writes on the
    // two sides of an `else` are one or the other, and a write handed a client (`db`, `tx`) is its caller's.
    const WRITE = /await this\.repo\.(remove|delete|set|save|create|update|add|mark|write|store|clear|replace|move|put)[A-Z]\w*\(([^;]*);/g;
    const isWrite = (call: RegExpMatchArray) => !/Count\(/.test(call[0]) && !/\b(db|tx)\b/.test(call[2]);
    const found: Hit[] = [];
    for (const { file, text } of office.filter(({ file }) => file.endsWith('.service.ts'))) {
      const method = /\n {2}(?:private |protected )?async (\w+)\(/g;
      for (let match = method.exec(text); match; match = method.exec(text)) {
        const body = blockAt(text, text.indexOf(')', match.index));
        if (/runTx\(/.test(body)) continue;
        const writes = Math.max(...body.split(/\} else (?:if \([^{]*\) )?\{/).map((side) => [...side.matchAll(WRITE)].filter(isWrite).length));
        if (writes >= 2) found.push({ file, line: lineOf(text, match.index) + 1, text: `${match[1]}: ${writes} writes` });
      }
    }
    check('multi-write-outside-tx', found);
  });

  it('1.3 root-client-in-tx: a transaction reads through its own client', () => {
    const found: Hit[] = [];
    for (const { file, text } of production) {
      const opener = /runTx\(async \((\w+)\) =>/g;
      for (let match = opener.exec(text); match; match = opener.exec(text)) {
        const body = blockAt(text, match.index + match[0].length);
        const inner = /this\.(kernel\.)?prisma\b/g;
        for (let use = inner.exec(body); use; use = inner.exec(body)) {
          found.push({ file, line: lineOf(text, text.indexOf(body) + use.index), text: use[0] });
        }
      }
    }
    check('root-client-in-tx', found);
  });

  it('2.1 unguarded-status-write: a status changes only through a guarded write', () => {
    check('unguarded-status-write', hits(office, /\.(line|officeTask)\.update\(/, (match, text) => {
      const call = text.slice(match.index, text.indexOf('});', match.index) + 3);
      return /\bstatus\s*:/.test(call);
    }));
  });

  it('3.1 inline-grant-checks: services ask the policy, not the actor', () => {
    const askers = production.filter(({ file }) => file.startsWith('modules/office/') && /\.(service|controller)\.ts$/.test(file));
    check('inline-grant-checks', hits(askers, /actor\.grants\.includes\(|actor\.isBranchOwner/));
  });

  it('4.1 hand-parsed-input: bodies are parsed by a schema', () => {
    check('hand-parsed-input', hits(production, /typeof body\??\.\w+/));
  });

  it('4.1 untyped-body: no free-form body on a route', () => {
    check('untyped-body', hits(production.filter(({ file }) => file.endsWith('.controller.ts')), /@Body\(\) \w+: (Record<string, unknown>|unknown)|schema: freeFormObject/));
  });

  it('4.7 list-envelope: a paged answer is { items, nextCursor, total } (shared/paging.ts)', () => {
    // An object that carries `nextCursor` names its rows `items`. Left on purpose until their slices of the
    // lists-and-routes plan: the users page (L.9) and the three report shapes (L.17).
    const answers = hits(office, /return \{/, (match, text) => {
      const body = blockAt(text, match.index);
      return /\bnextCursor\b/.test(body) && !/\bitems\b/.test(body);
    });
    check('list-envelope', answers);
  });

  it('4.9 login-field-name: a field that holds a login ends in LoginName', () => {
    // `parentLogin:`, `posLogin?:`, `actorLogin,` … as a property or a shorthand. Function names (`findByLogin`,
    // `decideLogin`) are not fields and are not matched.
    check('login-field-name', hits(production, /\b(parent|pos|actor|submitter|assignee|target|from|to)Login\b/));
  });

  it('4.3 conflict-status: a conflict answers 409', () => {
    check('conflict-status', hits(production, /fail\(4(?!09)\d\d, '(\w+_(TAKEN|EXISTS)|DUPLICATE_REQUEST)'/));
  });

  it('4.4 write-without-activity: every office write is recorded', () => {
    const found: Hit[] = [];
    for (const { file, text } of officeControllers) {
      const route = /@(Post|Put|Patch|Delete)\(/g;
      for (let match = route.exec(text); match; match = route.exec(text)) {
        // The decorators of one handler: from this one to the handler's opening brace.
        const head = text.slice(match.index, text.indexOf(') {', match.index));
        if (!/@Activity\(|@NoActivity\(/.test(head)) found.push({ file, line: lineOf(text, match.index), text: head.split('\n')[0] });
      }
    }
    check('write-without-activity', found);
  });

  it('5.2 cross-domain-controller-import: nothing imports a controller but a module', () => {
    check('cross-domain-controller-import', hits(production.filter(({ file }) => !file.endsWith('.module.ts')), /from '[^']+\.controller'/));
  });

  it('5.1 kernel-use: a domain names what it depends on, not a catch-all', () => {
    // OfficeKernel was taken apart on 2026-11-10 (plan office-kernel-split). No class comes back in its place:
    // a provider that most domains inject and that reaches into several of them is the same thing renamed.
    check('kernel-use', hits(production, /\bOfficeKernel\b|class \w*Kernel\b/));
  });

  it('5.1 prisma-in-service: queries live in a repository, not in a service', () => {
    // No exception: every service asks a repository (the last ten call sites left on 2026-11-10, plan
    // backend-loose-ends B.1).
    const services = production.filter(({ file }) => file.endsWith('.service.ts'));
    check('prisma-in-service', hits(services, /\.prisma\.\w+\.\w+\(|\btx\.\w+\.(find\w*|create\w*|update\w*|delete\w*|upsert|count|groupBy|aggregate)\(/));
  });

  it('5.1 unused-injection: a class injects only what it uses', () => {
    // A constructor parameter kept as a property (`private readonly x: X`) that the class never reads as `this.x`:
    // left from a refactor, it hides what the class depends on (eight of them on 2026-11-10, plan loose-ends B.2).
    const found: Hit[] = [];
    for (const { file, text } of office) {
      const ctor = /constructor\(([^{]*)\)\s*\{/g;
      for (let match = ctor.exec(text); match; match = ctor.exec(text)) {
        for (const param of match[1].matchAll(/(?:private |protected |public )?readonly (\w+)\s*:/g)) {
          const used = new RegExp(`this\\.${param[1]}\\b`).test(text);
          // A public property may be read from outside (`unit-of-work.ts` hands out `notice`); only private ones count.
          if (!used && /private |protected /.test(param[0])) found.push({ file, line: lineOf(text, match.index), text: param[1] });
          if (!used && !/private |protected |public /.test(param[0]) && file.endsWith('.service.ts')) found.push({ file, line: lineOf(text, match.index), text: param[1] });
        }
      }
    }
    check('unused-injection', found);
  });

  it('5.1 flat-office-module: each domain registers its own providers', () => {
    const module = production.find(({ file }) => file === 'modules/office/office.module.ts');
    const list = /export const OFFICE_PROVIDERS = \[([^\]]*)\]/.exec(module?.text ?? '')?.[1] ?? '';
    // Classes named one by one in the flat list; a spread of a domain's own list is not counted.
    const named = list.split(',').map((entry) => entry.trim()).filter((entry) => /^[A-Z]\w+$/.test(entry));
    check('flat-office-module', named.map((name) => ({ file: 'modules/office/office.module.ts', line: 1, text: name })));
  });

  it('5.2 cross-domain-repository-import: a domain reaches another through its service, never its queries', () => {
    const found: Hit[] = [];
    for (const { file, text } of office) {
      const domain = file.split('/')[2];
      const importer = /from '([^']+\.repository)'/g;
      for (let match = importer.exec(text); match; match = importer.exec(text)) {
        // `./x.repository` is the domain's own; `../other/x.repository` is another domain's.
        if (match[1].startsWith('../') && !match[1].startsWith(`../${domain}/`)) found.push({ file, line: lineOf(text, match.index), text: match[0] });
      }
    }
    check('cross-domain-repository-import', found);
  });

  it('3.5 session-id-as-token: a session id is never the cookie and never a Redis key', () => {
    // The cookie is a token; only its hash is stored (session-token.ts). A cookie written from `.id`, or a live key
    // built from an id, would put the bearer secret back into the database and the session list.
    check('session-id-as-token', hits(production, /res\.cookie\('(sid|home)',\s*[\w.]*\.id\b|sessionKey\((row|session)\.id\)|sessionKey\(sessionId\)/));
  });

  it('5.6 test-code-imported: production code never imports test helpers', () => {
    check('test-code-imported', hits(production, /from '[^']*(\/testing\/[^']*|\.fixture|\.spec)'/));
  });

  it('5.6 test-code-in-src: test helpers live in testing/ or are *.fixture.ts', () => {
    // A production file that builds an in-memory stand-in, a fake clock or a test app is a test helper in disguise.
    check('test-code-in-src', hits(production, /@nestjs\/testing|from 'supertest'|\bjest\./));
  });

  it('5.7 env-outside-config: process.env is read in config.ts only', () => {
    check('env-outside-config', hits(production.filter(({ file }) => file !== 'config.ts'), /process\.env\b/));
  });

  it('5.8 console-calls: the Nest Logger, not console', () => {
    check('console-calls', hits(production, /\bconsole\.(log|warn|error|info|debug)\(/));
  });

  it('5.9 stored-text: the API stores codes, not sentences', () => {
    const seeds = /catalog\/|trial-seed|cities\.ts|simulated-adapter|office-catalog\.ts|errors\.ts|stored-text\.ts/;
    check('stored-text', hits(production.filter(({ file }) => !seeds.test(file)), /^(?!\s*(\/\/|\*|\/\*)).*'[^'\n]*[֐-ۿ][^'\n]*'/m, (match) => !/@Api\w+\(/.test(match[0])));
  });
});
