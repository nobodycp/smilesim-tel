// The style check (ADR 0022, Tailwind migration T1.2): fails (exit 1) with file:line when the markup breaks a rule of
// the token + component system.
//
// It reads every .ts/.tsx file under app/, components/, features/ and lib/ with the TypeScript parser (comments are
// not read) and checks:
//   (a) physical-direction utilities, as class tokens in any string or template literal: ml-* mr-* pl-* pr-*
//       (and scroll-ml/mr/pl/pr), left-* right-* (insets), text-left text-right, border-l* border-r*, rounded-l*
//       rounded-r* and the corner forms rounded-tl/tr/bl/br*, float-left/right, clear-left/right. Variants (`md:`,
//       `hover:`, `[&>*]:`), `!` and negatives (`-ml-2`) are read through. An inset/margin/padding token needs a
//       Tailwind value (a number, a fraction, px, auto, full, `[…]` or `(…)`), so a legacy class such as `pr-badge`
//       is not one. A template part that ends in such a prefix (`ml-${n}`) counts too. Use the logical form:
//       ms me ps pe start end text-start text-end border-s border-e rounded-s rounded-e rounded-ss/se/es/ee
//       float-start/end clear-start/end;
//   (b) arbitrary colour values in a class token: `-[#…]`, `-[rgb(…)]`, `-[hsl(…)]`, `-[oklch(…)]` and the other
//       colour functions (rgba hsla oklab lab lch hwb color-mix), also behind a type hint (`bg-[color:#fff]`) or as an
//       arbitrary property (`[color:#fff]`). Colours are `@theme` tokens (`bg-surface`, `text-ink-2`);
//   (c) a literal colour in an inline style: a JSX `style={{ … }}` property among color, background*, any *Color,
//       fill, stroke, border, outline, boxShadow, textShadow whose value is a string or template literal with no
//       `${}` (a conditional or `??` / `||` of literals counts). A computed value (`markColor(name)`,
//       `` `var(${tone})` ``) is data, not a literal, and passes;
//   (d) a stylesheet (.css .scss .sass .less) anywhere under apps/web (dot folders, node_modules and the git-ignored
//       outputs audit-output, test-results, playwright-report are not read) other than app/tailwind.css and the
//       frozen legacy list below (empty since T5.1). A listed sheet that no longer exists is reported as a note: the
//       slice that deletes it removes it from LEGACY_SHEETS.
//
// Run: node scripts/check-styles.mjs              (npm run check:styles, in apps/web and at the root)
//      node scripts/check-styles.mjs --self-test  (proves every rule on fixtures; exit 1 if one is wrong)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

const SOURCE_DIRS = ['app', 'components', 'features', 'lib'];
const STYLESHEET = /\.(css|scss|sass|less)$/;
const SKIP_DIRS = new Set(['node_modules', 'audit-output', 'test-results', 'playwright-report']);

// The only stylesheet that stays (ADR 0022).
const TAILWIND_SHEET = 'app/tailwind.css';
// Frozen on 2026-11-15 (T1.2): the legacy sheets that T5 deletes. Never add to this list. Empty since Tailwind
// migration T5.1 deleted app/styles/ and app/globals.css: app/tailwind.css is the only stylesheet.
const LEGACY_SHEETS = [];

// ---------- (a) and (b): class tokens ----------

// The utility a token names, without its variants (`md:`, `hover:`, `[&:hover]:`, `group-hover/x:`), its important
// mark (`!x`, `x!`) and its negative sign. A ':' inside brackets or parentheses is part of an arbitrary variant/value.
function baseOf(token) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === '[' || char === '(') depth += 1;
    else if ((char === ']' || char === ')') && depth > 0) depth -= 1;
    else if (char === ':' && depth === 0) cut = i + 1;
  }
  let base = token.slice(cut);
  if (base.startsWith('!')) base = base.slice(1);
  if (base.endsWith('!')) base = base.slice(0, -1);
  if (base.startsWith('-')) base = base.slice(1);
  return base;
}

const VALUE = String.raw`(?:\d+(?:\.\d+)?|\d+\/\d+|px|auto|full|\[.+\]|\(.+\))`;
const SPACE_INSET = new RegExp(String.raw`^(?:scroll-)?(ml|mr|pl|pr|left|right)-${VALUE}$`);
const EDGE = /^(border|rounded)-(l|r|tl|tr|bl|br)(?:-.+)?$/;
const KEYWORD = /^(text|float|clear)-(left|right)$/;
// A template part that ends in a physical prefix: `ml-${n}`.
const DANGLING = /^(?:scroll-)?(ml|mr|pl|pr|left|right)-$|^(border|rounded)-(l|r|tl|tr|bl|br)-$/;

const LOGICAL = {
  ml: 'ms', mr: 'me', pl: 'ps', pr: 'pe', left: 'start', right: 'end',
  'border-l': 'border-s', 'border-r': 'border-e',
  'rounded-l': 'rounded-s', 'rounded-r': 'rounded-e',
  'rounded-tl': 'rounded-ss', 'rounded-tr': 'rounded-se', 'rounded-bl': 'rounded-es', 'rounded-br': 'rounded-ee',
};

function physical(token, dangling = false) {
  const base = baseOf(token);
  if (dangling) {
    const end = DANGLING.exec(base);
    if (!end) return null;
    const name = end[1] ?? `${end[2]}-${end[3]}`;
    return `${token}… → ${LOGICAL[name] ?? 'a logical utility'}-…`;
  }
  let match = SPACE_INSET.exec(base);
  if (match) return `${token} → ${base.replace(/^(scroll-)?[a-z]+/, (_, scroll = '') => scroll + LOGICAL[match[1]])}`;
  match = EDGE.exec(base);
  if (match) {
    const name = `${match[1]}-${match[2]}`;
    // `border-tl` is not a Tailwind utility; only rounded has corner forms.
    if (match[1] === 'border' && match[2].length === 2) return null;
    return `${token} → ${base.replace(name, LOGICAL[name])}`;
  }
  match = KEYWORD.exec(base);
  if (match) return `${token} → ${match[1]}-${match[2] === 'left' ? 'start' : 'end'}`;
  return null;
}

// Inside the brackets of an arbitrary value or property: a hex colour or a colour function, anywhere in it.
const COLOUR_VALUE = /#[0-9a-f]{3,8}(?![0-9a-z])|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/i;

function arbitraryColour(token) {
  return [...baseOf(token).matchAll(/\[([^\]]*)\]/g)].some((group) => COLOUR_VALUE.test(group[1])) ? token : null;
}

// Tokens of one literal part; `dangling` is true when a `${}` follows the part (the last token runs into it).
function classHits(text, dangling) {
  const hits = [];
  const tokens = text.split(/\s+/).filter(Boolean);
  const openEnd = dangling && text.length > 0 && !/\s$/.test(text);
  tokens.forEach((token, index) => {
    const last = openEnd && index === tokens.length - 1;
    const direction = physical(token) ?? (last ? physical(token, true) : null);
    if (direction) hits.push({ rule: 'physical utility', detail: direction });
    if (arbitraryColour(token)) hits.push({ rule: 'arbitrary colour', detail: `${token} → a colour token (bg-surface, text-ink-2 …)` });
  });
  return hits;
}

// ---------- (c): inline style colours ----------

const COLOUR_PROPERTY = /^(color|background\w*|\w+Color|fill|stroke|border|outline|boxShadow|textShadow)$/;

function literalLeaves(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)) node = node.expression;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isConditionalExpression(node)) return [...literalLeaves(node.whenTrue), ...literalLeaves(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    return [...literalLeaves(node.left), ...literalLeaves(node.right)];
  }
  return [];
}

function propertyName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return null;
}

// ---------- one source file ----------

function checkSource(name, text) {
  const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  const problems = [];
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source));
  const report = (node, rule, detail) => {
    const { line, character } = at(node);
    problems.push(`${name}:${line + 1}:${character + 1} ${rule}: ${detail}`);
  };

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const hit of classHits(node.text, false)) report(node, hit.rule, hit.detail);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head, ...node.templateSpans.map((span) => span.literal)];
      parts.forEach((part) => {
        const followed = !ts.isTemplateTail(part);
        // The text after a `${}` starts mid-token (`${n}px`): its first token is not a class token on its own.
        const text = part === node.head ? part.text : part.text.replace(/^\S*/, '');
        for (const hit of classHits(text, followed)) report(part, hit.rule, hit.detail);
      });
    } else if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style' && node.initializer
      && ts.isJsxExpression(node.initializer) && node.initializer.expression
      && ts.isObjectLiteralExpression(node.initializer.expression)) {
      for (const property of node.initializer.expression.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyName(property);
        if (!key || !COLOUR_PROPERTY.test(key)) continue;
        for (const leaf of literalLeaves(property.initializer)) {
          report(leaf, 'inline colour', `style ${key}: '${leaf.text}' → a colour class (bg-surface, text-ink-2 …)`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

// ---------- (d): stylesheets ----------

function checkSheets(paths, legacy = LEGACY_SHEETS) {
  const allowed = new Set([TAILWIND_SHEET, ...legacy]);
  const problems = paths.filter((path) => !allowed.has(path))
    .map((path) => `${path}:1:1 stylesheet: a new stylesheet → utilities in the markup, variants in components/ui (ADR 0022)`);
  const present = new Set(paths);
  const notes = legacy.filter((path) => !present.has(path))
    .map((path) => `note: ${path} is gone; remove it from LEGACY_SHEETS in scripts/check-styles.mjs`);
  return { problems, notes };
}

// ---------- the tree ----------

const posix = (path) => path.split(sep).join('/');

function walk(dir, keep, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, keep, found);
    else if (keep(entry.name)) found.push(posix(relative(web, path)));
  }
  return found;
}

function checkTree() {
  const sources = SOURCE_DIRS.filter((dir) => existsSync(join(web, dir)))
    .flatMap((dir) => walk(join(web, dir), (name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts')));
  const problems = sources.flatMap((path) => checkSource(path, readFileSync(join(web, path), 'utf8')));
  const sheets = checkSheets(walk(web, (name) => STYLESHEET.test(name)));
  return { problems: [...problems, ...sheets.problems], notes: sheets.notes, files: sources.length };
}

// ---------- --self-test ----------

function selfTest() {
  const failures = [];
  const expect = (label, problems, count) => {
    if (problems.length !== count) failures.push(`${label}: expected ${count} hit(s), got ${problems.length}\n    ${problems.join('\n    ')}`);
  };
  const tsx = (body) => checkSource('fixture.tsx', body);

  // (a) every physical form fails, with variants, important and negatives read through.
  const physicalTokens = ['ml-2', 'mr-0.5', 'pl-4', 'pr-px', 'left-0', 'right-1/2', 'left-full', '-left-2', 'right-[3px]',
    'ml-(--gap)', 'md:ml-auto', 'hover:pr-3', '[&>*]:pl-2', '!mr-1', 'mr-1!', 'scroll-ml-4', 'text-left', 'max-sm:text-right',
    'border-l', 'border-r-2', 'border-l-line', 'rounded-l', 'rounded-r-card', 'rounded-tl-sm', 'rounded-br', 'float-left',
    'clear-right'];
  for (const token of physicalTokens) expect(`(a) ${token}`, tsx(`<div className="${token}" />`), 1);
  expect('(a) template part ending in a prefix', tsx('<div className={`flex ml-${gap}`} />'), 1);
  expect('(a) cva/cn arguments and constants', tsx("const base = 'px-2 ml-1'; cn('pr-2', ok && 'left-0');"), 3);
  // Logical forms, legacy names and text pass.
  const logicalTokens = ['ms-2', 'me-0.5', 'ps-4', 'pe-px', 'start-0', 'end-1/2', '-start-2', 'md:ms-auto', 'text-start',
    'text-end', 'border-s', 'border-e-2', 'rounded-s', 'rounded-e-card', 'rounded-ss-sm', 'rounded-ee', 'float-start',
    'pr-badge', 'left-pane', 'border-line', 'rounded-lg', 'text-lg', 'inset-x-0', 'top-0', 'bottom-2', 'pt-2', 'mb-1'];
  for (const token of logicalTokens) expect(`(a) passes ${token}`, tsx(`<div className="${token}" />`), 0);
  expect('(a) comments are not read', tsx('// ml-2 text-left\n/* pr-4 */ const x = 1;'), 0);
  expect('(a) the text after ${} starts mid-token', tsx('const w = `${n}px ms-2`;'), 0);

  // (b) arbitrary colours fail; tokens and variables pass.
  for (const token of ['bg-[#fff]', 'text-[rgb(0_0_0)]', 'border-[rgba(0,0,0,.2)]', 'bg-[hsl(0_0%_0%)]', 'fill-[oklch(0.5_0.1_20)]',
    'hover:bg-[#123456]/50', 'bg-[color:#fff]', '[color:#fff]', 'shadow-[0_0_0_1px_rgb(0_0_0)]', 'bg-[color-mix(in_oklab,red,blue)]']) {
    expect(`(b) ${token}`, tsx(`<div className="${token}" />`), 1);
  }
  for (const token of ['bg-surface', 'text-ink-2', 'bg-(--rd-surface)', 'w-[3px]', 'grid-cols-[1fr_auto]']) {
    expect(`(b) passes ${token}`, tsx(`<div className="${token}" />`), 0);
  }
  expect('(b) a link fragment is not a class', tsx('<a href="#main">x</a>'), 0);

  // (c) literal colours in style={{}} fail; computed values and non-colour properties pass.
  expect('(c) color literal', tsx("<i style={{ color: '#fff' }} />"), 1);
  expect('(c) background literal', tsx("<i style={{ background: 'red' }} />"), 1);
  expect('(c) backgroundColor template', tsx('<i style={{ backgroundColor: `var(--rd-surface)` }} />'), 1);
  expect('(c) borderInlineStartColor', tsx("<i style={{ borderInlineStartColor: 'blue' }} />"), 1);
  expect('(c) fill and stroke', tsx("<i style={{ fill: 'red', stroke: 'blue' }} />"), 2);
  expect('(c) conditional of literals', tsx("<i style={{ color: on ? '#000' : '#fff' }} />"), 2);
  expect('(c) quoted key', tsx("<i style={{ 'color': 'red' }} />"), 1);
  expect('(c) computed value passes', tsx('<i style={{ background: markColor(name) }} />'), 0);
  expect('(c) template with ${} passes', tsx('<i style={{ stroke: `var(${tone})` }} />'), 0);
  expect('(c) non-colour property passes', tsx("<i style={{ inlineSize: '50%', colorScheme: 'dark', top: 4 }} />"), 0);
  expect('(c) a variable style passes', tsx('<i style={s} />'), 0);

  // (d) a new stylesheet fails; the Tailwind sheet and the legacy list pass; a gone legacy sheet is a note. The list is
  // empty since T5.1, so the list cases run on a fixture list.
  const FIXTURE_LEGACY = ['app/globals.css', 'app/styles/base.css'];
  const sheets = checkSheets([TAILWIND_SHEET, ...FIXTURE_LEGACY.slice(1), 'components/x.module.css', 'app/new.scss'], FIXTURE_LEGACY);
  expect('(d) new stylesheets', sheets.problems, 2);
  expect('(d) a deleted legacy sheet is a note', sheets.notes, 1);
  expect('(d) the frozen list passes', checkSheets([TAILWIND_SHEET, ...FIXTURE_LEGACY], FIXTURE_LEGACY).problems, 0);
  expect('(d) the Tailwind sheet alone passes', checkSheets([TAILWIND_SHEET]).problems, 0);
  expect('(d) a deleted sheet fails once it is off the list', checkSheets([TAILWIND_SHEET, 'app/styles/base.css']).problems, 1);

  if (failures.length > 0) {
    console.error(`check-styles self-test: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('check-styles self-test: every rule holds');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { problems, notes, files } = checkTree();
  for (const note of notes) console.log(note);
  if (problems.length > 0) {
    console.error(`check-styles: ${problems.length} problem(s)\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`check-styles: ${files} source files, no physical utilities, raw colours or new stylesheets`);
}
