// The CSS guard (UI maintenance P1.1): fails (exit 1) when a cascade count rises above its ratchet baseline.
//
// It parses every sheet under app/styles/ (recursively; app/globals.css holds only imports) with postcss — already
// a dev dependency, no new one — and counts twelve kinds of hit:
//   (a) duplicates — keyed by (at-rule chain, selector, property). The at-rule chain is the list of enclosing
//       @media / @container / @supports / @keyframes preludes, whitespace-normalised, so a mobile-first base rule
//       plus a `@media (min-width: …)` override of the same property is two keys and not a duplicate, and the
//       `from { opacity: 0 }` of two different keyframes are two keys. Selector lists are split on top-level commas,
//       so `.a, .b { x }` plus `.b { x }` is one duplicate. A key counts once for each declaration of it beyond the
//       first, in one file or across files — a property declared twice inside one block counts too (no same-rule
//       exemption: plan, P1.1 review notes). Selectors are normalised for whitespace (around combinators, commas and
//       parentheses) and attribute quoting (`[x='1']`, `[x=1]` and `[x="1"]` are one key); at-rule preludes for
//       whitespace (`(max-width:767px)` and `( max-width: 767px )` are one chain). Custom properties
//       (`--ui-btn-shadow`) are keys like any other property. A nested rule (CSS nesting, `&:hover`) or a nested
//       at-rule (`.a { @media … { … } }`) fails the run loudly: its key would need the parent selector, which the
//       guard does not build.
//   (b) `var(--rd-x)` where `--rd-x` is not defined in tokens.css (any file, tokens.css included);
//   (c) `var(--rd-x, fallback)` where `--rd-x` is defined in tokens.css;
//   (d) a hex colour, `rgb(`, `rgba(`, `hsl(` or `hsla(` in a declaration value outside tokens.css (named colours
//       such as `white` are not counted; selectors, `url()` and strings are not read);
//   (e) an outline removal — `outline` whose value holds `none`, `hidden` or a zero width (`none`, `0`, `0 none`,
//       `0px solid`), `outline-style: none|hidden` or `outline-width: 0` — in a declaration block that sets no
//       replacement: a `box-shadow` other than `none`, or an `outline` / `outline-style` that draws one.
//       `outline-offset` and `outline-color` are not a replacement; one in another rule for the same selector does
//       not count either;
//   (f) `font-size` with a `.5px` value or a `rem` value (the `font` shorthand is not read);
//   (g) `font-weight: 800` or `900`;
//   (h) an `@media` width feature outside the scale, direction checked: `max-width` ∈ {640, 767, 899, 1099}px,
//       `min-width` ∈ {641, 768, 900, 1100}px (each width feature of a compound query on its own; height, motion
//       and other features are not read; `@container` queries are not counted). Counted from today; it fails at
//       zero from P5, where P5.1 fills MEDIA_EXCEPTIONS (D26) below;
//   (i) physical properties: `margin-left|right|top|bottom`, `padding-left|right|top|bottom`, `left`, `right`,
//       `border-left|right|top|bottom` and their longhands (`border-top-left-radius` included), and
//       `text-align: left|right`;
//   (j) `line-height` with a literal value (anything but `var(--rd-…)`, `normal`, `0` or `inherit`) outside
//       tokens.css, unless the (file, selector, property) is in ONE_OFFS;
//   (k) a literal length in `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` or `border-radius*` outside
//       tokens.css: every whitespace-separated component of the value must be `0`, `auto`, `50%`, a keyword, a
//       `var(--rd-…)` or a function (`calc()`, `max()`, `env()` …) built only from tokens and unitless numbers
//       (a `var()` of any other custom property, `var(--pad)`, counts: it can carry any literal);
//       any other number with a unit counts — every length unit and every percentage (`10%`, `100%`, `-50%`, a
//       `100%` inside `calc()`), negative or not — once per declaration. Exceptions are in ONE_OFFS;
//   (l) `opacity` with a literal number in a rule any of whose selectors carries `:disabled` or `[aria-disabled`
//       (outside a `:not(…)`), counted once per such selector member (anything but `var(--rd-disabled-opacity)`).
//       Counted from today; it fails at zero from the P3 gate (P3.1 step 4).
// Every count reads inside @keyframes too; (a) keys a keyframe step (`from`, `50%`) under its keyframes name.
//
// Ratchet: scripts/css-baseline.json holds each count and the hits behind it, keyed without line numbers
// (file | at-rule chain | selector | property | value). The run fails if a count is above its baseline and prints
// the hits that are not in the baseline; when a count drops it prints "ratchet: lower <key> to N" (the slice that
// lowers it rewrites the baseline with --write-baseline). A parse error fails loudly with file:line:col.
//
// Run: node scripts/check-css.mjs                     (inside `npm run lint` in apps/web)
//      node scripts/check-css.mjs --list <key>        (print every hit of one count, with file:line)
//      node scripts/check-css.mjs --write-baseline    (rewrite the baseline from the current sheets)
//      node scripts/check-css.mjs --dir <styles> --baseline <file>   (a scratch copy, for canaries)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postcss = require('postcss');

const web = join(dirname(fileURLToPath(import.meta.url)), '..');

// Named one-off exceptions for (j) and (k): file (relative to the styles folder), selector, property, reason.
// Each entry is mirrored in DESIGN.md "Stylesheets" → "CSS guard". P1.4 adds the four fixed-box centring
// line-heights.
const ONE_OFFS = [];

// Named @media width exceptions for (h) (ADR 0021 D26): file, prelude, reason. Written by P5.1.
const MEDIA_EXCEPTIONS = [];

const KEYS = {
  a: 'a-duplicate',
  b: 'b-undefined-token',
  c: 'c-fallback-on-defined-token',
  d: 'd-raw-colour',
  e: 'e-outline-removed',
  f: 'f-font-size-half-px-or-rem',
  g: 'g-font-weight-800-900',
  h: 'h-media-width',
  i: 'i-physical-property',
  j: 'j-literal-line-height',
  k: 'k-literal-spacing-radius',
  l: 'l-disabled-opacity',
};

const MAX_WIDTHS = new Set([640, 767, 899, 1099]);
const MIN_WIDTHS = new Set([641, 768, 900, 1100]);

function parseArgs(argv) {
  const args = { dir: join(web, 'app', 'styles'), baseline: join(web, 'scripts', 'css-baseline.json'), list: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') args.dir = argv[(i += 1)];
    else if (arg === '--baseline') args.baseline = argv[(i += 1)];
    else if (arg === '--list') args.list = argv[(i += 1)];
    else if (arg === '--write-baseline') args.write = true;
    else throw new Error(`check-css: unknown argument ${arg}`);
  }
  return args;
}

function sheets(dir) {
  const out = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.css')) out.push(path);
    }
  };
  walk(dir);
  return out.sort();
}

const squash = (text) => text.replace(/\s+/g, ' ').trim();

// Splits on a separator that is not inside (), [] or quotes.
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && (separator === ' ' ? /\s/.test(char) : char === separator)) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// `name op "value" flag`: one spelling for every quoting of an attribute selector.
function normaliseAttribute(body) {
  const match = /^\s*([^\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))\s*([is])?\s*)?$/i.exec(body);
  if (!match) return `[${squash(body)}]`;
  const [, name, op, double, single, bare, flag] = match;
  const value = double ?? single ?? bare;
  return `[${name}${op ? `${op}"${value}"` : ''}${flag ? ` ${flag.toLowerCase()}` : ''}]`;
}

// One spelling per selector: attribute selectors and strings normalised (and kept apart while the rest is read),
// whitespace collapsed, none around combinators, commas and inside parentheses.
function normaliseSelector(selector) {
  const kept = [];
  let text = '';
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === '[' || char === '"' || char === "'") {
      let j = i + 1;
      let quote = char === '[' ? null : char;
      for (; j < selector.length; j += 1) {
        const next = selector[j];
        if (char !== '[') { if (next === char) break; continue; }
        if (quote) { if (next === quote) quote = null; } else if (next === '"' || next === "'") quote = next;
        else if (next === ']') break;
      }
      kept.push(char === '[' ? normaliseAttribute(selector.slice(i + 1, j)) : `"${selector.slice(i + 1, j)}"`);
      text += `\u0000${kept.length - 1}\u0000`;
      i = j;
    } else text += char;
  }
  return squash(text)
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\u0000(\d+)\u0000/g, (_, index) => kept[Number(index)]);
}

// An at-rule prelude with one spelling: whitespace collapsed, none inside parentheses or around `:` and `,`.
const normalisePrelude = (params) => squash(params).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*([:,])\s*/g, '$1');

// The enclosing at-rule preludes, outermost first.
function chainOf(node) {
  const chain = [];
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') chain.unshift(`@${parent.name} ${normalisePrelude(parent.params)}`);
  }
  return chain.join(' > ');
}

// An outline that draws nothing: `none` / `hidden` as its style or a zero width.
const ZERO = /^0(px|r?em|ch|ex)?$/i;
function outlineRemoved(prop, value) {
  const parts = value.trim().toLowerCase().split(/\s+/);
  if (prop === 'outline') return parts.some((part) => part === 'none' || part === 'hidden' || ZERO.test(part));
  if (prop === 'outline-style') return parts[0] === 'none' || parts[0] === 'hidden';
  if (prop === 'outline-width') return ZERO.test(parts[0]);
  return false;
}

// Removes strings and url(...) so their contents are never read as colours or lengths.
const stripOpaque = (value) => value.replace(/url\([^)]*\)/gi, 'url()').replace(/"[^"]*"|'[^']*'/g, '""');

// Removes every var(--rd-…) (nested parentheses included), so a token reference is never read as a literal. Any
// other var() — a local custom property — stays and is counted by (k): it can hide a literal.
function stripVars(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (/^var\(\s*--rd-/.test(value.slice(i, i + 64))) {
      let depth = 0;
      let j = i + 3;
      for (; j < value.length; j += 1) {
        if (value[j] === '(') depth += 1;
        else if (value[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out += 'TOKEN';
      i = j;
    } else out += value[i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = sheets(args.dir);
  const roots = [];
  for (const file of files) {
    const css = readFileSync(file, 'utf8');
    try {
      roots.push({ file: relative(args.dir, file), root: postcss.parse(css, { from: file }) });
    } catch (error) {
      const where = error.line ? `${relative(web, file)}:${error.line}:${error.column}` : relative(web, file);
      console.error(`check-css: parse error in ${where}: ${error.reason ?? error.message}`);
      process.exit(1);
    }
    // CSS nesting: a rule or an at-rule (`@media` inside `.a { … }`) below a rule. Its declarations would be keyed
    // without the parent selector (a) or not read at all (e, l), so the run stops.
    let nested = null;
    roots.at(-1).root.walk((node) => {
      if (nested || (node.type !== 'rule' && node.type !== 'atrule')) return;
      for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
        if (parent.type === 'rule') {
          nested = node;
          break;
        }
      }
    });
    if (nested) {
      const what = nested.type === 'rule' ? `rule \`${squash(nested.selector)}\`` : `at-rule \`@${nested.name} ${squash(nested.params)}\``;
      console.error(`check-css: nested ${what} in ${relative(web, file)}:${nested.source?.start?.line ?? 0}: `
        + 'the guard keys a selector without its parent; write the rule flat (or teach the guard nesting)');
      process.exit(1);
    }
  }

  const tokens = roots.find((sheet) => sheet.file === 'tokens.css');
  if (!tokens) {
    console.error(`check-css: no tokens.css in ${relative(web, args.dir) || args.dir}`);
    process.exit(1);
  }
  const defined = new Set();
  tokens.root.walkDecls(/^--rd-/, (decl) => defined.add(decl.prop));

  const hits = Object.fromEntries(Object.values(KEYS).map((key) => [key, []]));
  const hit = (key, file, node, parts) => hits[KEYS[key]].push({ id: [file, ...parts].join(' | '), at: `${file}:${node.source?.start?.line ?? 0}` });
  const oneOff = (file, selector, prop) => ONE_OFFS.some((entry) => entry.file === file && normaliseSelector(entry.selector) === selector && entry.prop === prop);
  const duplicates = new Map();

  for (const { file, root } of roots) {
    const isTokens = file === 'tokens.css';

    root.walkAtRules('media', (rule) => {
      const prelude = normalisePrelude(rule.params);
      if (MEDIA_EXCEPTIONS.some((entry) => entry.file === file && normalisePrelude(entry.prelude) === prelude)) return;
      for (const match of prelude.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/g)) {
        const [, side, number, unit = ''] = match;
        const allowed = unit === 'px' && (side === 'max' ? MAX_WIDTHS : MIN_WIDTHS).has(Number(number));
        if (!allowed) hit('h', file, rule, [`@media ${prelude}`, `${side}-width: ${number}${unit}`]);
      }
      if (/width\s*[<>]=?|[<>]=?\s*width/.test(prelude)) hit('h', file, rule, [`@media ${prelude}`, 'range syntax']);
    });

    root.walkDecls((decl) => {
      const value = decl.value;
      const prop = decl.prop.toLowerCase();
      const rule = decl.parent;
      const inRule = rule?.type === 'rule';
      const selector = inRule ? normaliseSelector(rule.selector) : `@${rule?.name ?? ''}`;
      const chain = chainOf(inRule ? rule : decl);
      const where = [chain, selector, prop, squash(value)];

      for (const match of value.matchAll(/var\(\s*(--rd-[a-z0-9-]+)\s*(,)?/gi)) {
        if (!defined.has(match[1])) hit('b', file, decl, [...where, match[1]]);
        else if (match[2]) hit('c', file, decl, [...where, match[1]]);
      }

      if (!isTokens) {
        const plain = stripOpaque(value);
        if (/#[0-9a-f]{3,8}\b/i.test(plain) || /\b(rgba?|hsla?)\(/i.test(plain)) hit('d', file, decl, where);
      }

      if (prop === 'font-size' && (/\d*\.5px\b/.test(value) || /\d(\.\d+)?rem\b/.test(value))) hit('f', file, decl, where);
      if (prop === 'font-weight' && /^(800|900)$/.test(value.trim())) hit('g', file, decl, where);

      if (/^(margin|padding)-(left|right|top|bottom)$/.test(prop) || prop === 'left' || prop === 'right'
        || /^border-(left|right|top|bottom)(-|$)/.test(prop) || (prop === 'text-align' && /^(left|right)$/.test(value.trim()))) {
        hit('i', file, decl, where);
      }

      if (!isTokens && prop === 'line-height') {
        const plainValue = value.trim();
        const fine = /^var\(--rd-[a-z0-9-]+\)$/.test(plainValue) || ['normal', '0', 'inherit'].includes(plainValue);
        if (!fine && !oneOff(file, selector, prop)) hit('j', file, decl, where);
      }

      if (!isTokens && /^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$|^border(-[a-z]+)*-radius$/.test(prop)) {
        const literal = splitTop(stripOpaque(value), ' ').some((part) => {
          if (part === '0' || part === 'auto' || part === '50%') return false;
          const plainPart = stripVars(part);
          // A var() other than a token (a local custom property) is not allowed: it can carry any literal.
          if (/\bvar\(/i.test(plainPart)) return true;
          // A number with any unit after it (letters or %), not part of a name: `\b` would never match after `%`.
          return /(^|[^a-z0-9_.-])-?(\d+\.?\d*|\.\d+)(%|[a-z]+)/i.test(plainPart);
        });
        if (literal && !oneOff(file, selector, prop)) hit('k', file, decl, where);
      }

      if (inRule) {
        for (const member of splitTop(rule.selector, ',')) {
          const key = `${chain} || ${normaliseSelector(member)} || ${prop}`;
          const list = duplicates.get(key) ?? [];
          list.push({ file, decl });
          duplicates.set(key, list);
        }
      }
    });

    root.walkRules((rule) => {
      const decls = rule.nodes.filter((node) => node.type === 'decl');
      const selector = normaliseSelector(rule.selector);
      const chain = chainOf(rule);
      for (const decl of decls) {
        const prop = decl.prop.toLowerCase();
        if (!outlineRemoved(prop, decl.value)) continue;
        const replaced = decls.some((other) => {
          const otherProp = other.prop.toLowerCase();
          if (other === decl) return false;
          if (otherProp === 'box-shadow') return other.value.trim().toLowerCase() !== 'none';
          return (otherProp === 'outline' || otherProp === 'outline-style') && !outlineRemoved(otherProp, other.value);
        });
        if (!replaced) hit('e', file, decl, [chain, selector, prop, squash(decl.value)]);
      }

      const members = splitTop(rule.selector, ',').filter((member) => {
        const outside = member.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
        return outside.includes(':disabled') || outside.includes('[aria-disabled');
      });
      if (members.length) {
        for (const decl of decls) {
          if (decl.prop.toLowerCase() !== 'opacity' || decl.value.trim() === 'var(--rd-disabled-opacity)') continue;
          for (const member of members) hit('l', file, decl, [chain, normaliseSelector(member), 'opacity', decl.value.trim()]);
        }
      }
    });
  }

  for (const [key, list] of duplicates) {
    if (list.length < 2) continue;
    const [chain, selector, prop] = key.split(' || ');
    for (const entry of list.slice(1)) {
      const first = list[0];
      hits[KEYS.a].push({
        id: [entry.file, chain, selector, prop, `also in ${first.file}`].join(' | '),
        at: `${entry.file}:${entry.decl.source?.start?.line ?? 0} (first: ${first.file}:${first.decl.source?.start?.line ?? 0})`,
      });
    }
  }

  const counts = Object.fromEntries(Object.entries(hits).map(([key, list]) => [key, list.length]));

  if (args.list) {
    const key = Object.values(KEYS).find((name) => name === args.list || name.startsWith(`${args.list}-`));
    if (!key) throw new Error(`check-css: unknown key ${args.list}`);
    for (const entry of hits[key]) console.log(`${entry.at}\t${entry.id}`);
    console.log(`${key}: ${hits[key].length}`);
    return;
  }

  if (args.write) {
    const baseline = { note: 'Written by `node scripts/check-css.mjs --write-baseline`. A count may only go down.', counts, hits: {} };
    for (const [key, list] of Object.entries(hits)) baseline.hits[key] = list.map((entry) => entry.id).sort();
    writeFileSync(args.baseline, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`check-css: baseline written (${Object.entries(counts).map(([key, n]) => `${key}=${n}`).join(', ')})`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
  } catch (error) {
    console.error(`check-css: cannot read the baseline ${args.baseline}: ${error.message}`);
    process.exit(1);
  }

  let failed = false;
  for (const [key, count] of Object.entries(counts)) {
    const allowed = baseline.counts?.[key];
    if (allowed === undefined) {
      console.error(`check-css: ${key} has no baseline entry`);
      failed = true;
      continue;
    }
    if (count > allowed) {
      failed = true;
      console.error(`check-css: ${key} rose to ${count} (baseline ${allowed}). New hits:`);
      const known = new Map();
      for (const id of baseline.hits?.[key] ?? []) known.set(id, (known.get(id) ?? 0) + 1);
      for (const entry of hits[key]) {
        const left = known.get(entry.id) ?? 0;
        if (left > 0) known.set(entry.id, left - 1);
        else console.error(`  ${entry.at}\t${entry.id}`);
      }
    } else if (count < allowed) {
      console.log(`ratchet: lower ${key} to ${count}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`check-css: ${files.length} sheets, no count above its baseline`);
}

main();
