// Fails (exit 1) when content on a crimson fill is not legible in either theme (ADR 0021 D1, UI maintenance P0.9).
//
// It reads the tokens in app/tailwind.css (`:root` is light, `.dark` is dark on top of it; the app's one stylesheet),
// then scans that sheet's rules (the global
// rules in its `@layer base`) for rules whose `background` / `background-color` paints a crimson fill
// colour — the value's colour component, whatever else the shorthand holds (`var(--rd-accent) no-repeat` counts;
// gradients and `url()` layers are set aside, so a crimson glow inside a gradient is not a fill):
//   - `var(--rd-accent)`, `var(--rd-accent-fill)`, `var(--rd-accent-fill-hover)`;
//   - a `color-mix(…var(--rd-accent)…)` / `color-mix(…var(--rd-accent-fill)…)` hover recipe;
//   - any `:hover` / `:active` / `:focus…` / `:checked` rule whose base selector is a crimson fill and that sets a
//     background or a `color` (so a hover that turns the fill another colour, or the text another colour, under the
//     same element is measured too);
//   - any variant of a crimson fill — the fill selector with an attribute selector, a class or a pseudo-class added,
//     or with an ancestor in front (`.ui-btn.ui-btn-primary[aria-pressed='true']`, `.dialog .ui-btn.ui-btn-primary`) —
//     that sets only a new `color` on it.
// For each such selector it finds what is drawn on the fill — `color` (the selector's own or its base's, merged across
// rules in cascade order), `stroke` on its `svg`, the `::before` background (the checkbox and radio mark). When none
// is set on the selector or its state bases, the content is looked up on the selectors it extends (the same selector
// with attribute selectors, classes or pseudo-classes taken off its last compound, or its ancestors dropped; the most
// specific one that sets the property wins), so a variant that sets a new fill and inherits its text is measured too.
// A crimson fill whose content still cannot be found fails unless it is on the ALLOWLIST. It then checks
// the WCAG ratio in both themes: text ≥ 4.5:1, glyph-only content (an svg stroke, a ::before mark, the selectors in
// GLYPH) ≥ 3:1. A translucent content colour is composited over the fill before the ratio is taken. Text drawn by
// other elements over a fill (OVERLAY; empty in the app, exercised by the self-test) is checked the
// same way, over the fill composited at the rule's `opacity` on each backdrop listed. It also fails on a bare
// `var(--rd-accent)` fill (the thread colour, not the fill token) that is not on the ALLOWLIST below: content on
// crimson uses `--rd-accent-fill`, and decoration (a crimson fill with nothing drawn on it) is listed with its reason.
//
// Run: node scripts/contrast.mjs            (a local check; not part of npm run lint)
//      node scripts/contrast.mjs --self-test (eighteen must-fail / must-pass cases)

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(web, 'app', 'tailwind.css');

// Glyph-only content drawn with `color` (the svg uses currentColor): ≥ 3:1 suffices. Empty: the sign-in mark is a
// utility class list (markClass) in components/auth-art.tsx, which this sheet reader cannot see.
const GLYPH = new Set();

// Fills whose content is drawn by other elements on top of them (siblings painted above, not the rule's own color).
// Each lists the backdrops the fill is composited on at its `opacity` (the lightest one decides) and the content
// selectors, each with the selectors its `color` falls back to (inheritance), in order. Empty: the sign-in art's
// tag is a utility class list in components/auth-art.tsx (bg-accent-fill at opacity-88 under text-login-ink), which
// this sheet reader cannot see. ART_OVERLAY below is a sample entry of that shape for the self-test.
const OVERLAY = new Map();

// A sample overlay (a sign-in art tag under its heading and line) for the self-test cases that exercise the OVERLAY
// path.
const ART_OVERLAY = new Map([
  ['.gauth-art-tag', {
    why: 'self-test: the art heading and line drawn over the tag (h2, p: position relative, same corner)',
    backdrops: ['var(--rd-login-room)', 'color-mix(in srgb, var(--rd-accent) 22%, var(--rd-login-room))'],
    content: [['.gauth-art h2', '.gauth-art'], ['.gauth-art p', '.gauth-art']],
  }],
]);

// Crimson fills with no content of their own — decoration on the bare `var(--rd-accent)` thread colour, and dead
// rules — each with its reason. A fill outside this list must have content that can be measured.
const ALLOWLIST = new Map([
  ['.dialog::before', 'the dialog thread: decoration, no content'],
  ['.topbar::after', 'the topbar hairline: decoration, no content'],
  ['.cap-bar i', 'a meter bar: decoration, no content'],
  ['.unread-dot', 'the unread dot: decoration, no content'],
  ['.hero-bar i.on', 'the offer timer bar: decoration, no content'],
  ['.trend-dot', 'the trend point: decoration, no content'],
  ['.nav-link.active::before', 'the active rail bar: decoration, no content'],
  ['.nav-link.nested.active .nav-bullet', 'the nested nav bullet: decoration, no content'],
  ['.sidebar.collapsed .nav-link.holds::before', 'the folded rail mark: decoration, no content'],
  ['.shell-item.unread strong::before', 'the unread notice dot: decoration, no content'],
  ['.figure-tile.lead::before', 'the lead tile thread: decoration, no content'],
  ['.users-meter i', 'a meter bar: decoration, no content'],
  ['.brand-rule', 'the brand rule: decoration, no content'],
  ['.notice-dot', 'dead (no markup uses it): P2.1b deletes it'],
  ['.login-seam', 'dead (no page uses .login-room): P2.1a deletes it'],
  ['.notice-count', 'an 8px dot: its color paints nothing (font-size: 0); P2.1b drops its color, then this entry goes'],
  ['.pack-card > button', 'dead (no markup uses it): P2.1c deletes it'],
  ['.login-room form > button.login-go', 'dead (no page uses .login-room): P2.1a deletes it'],
  ['.login-room form > button.login-go:disabled', 'dead (no page uses .login-room): P2.1a deletes it'],
  ['.login-room form > button.login-go:disabled:hover', 'dead (no page uses .login-room): P2.1a deletes it'],
  ['.login-room form > button.login-go:hover', 'dead (no page uses .login-room): P2.1a deletes it'],
]);

// ── Colour values ──
const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

function splitTop(text, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseColor(raw, vars, seen = new Set()) {
  const v = raw.trim().replace(/\s*!important$/, '');
  const ref = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i);
  if (ref) {
    if (seen.has(ref[1])) throw new Error(`token cycle at ${ref[1]}`);
    const next = vars.get(ref[1]) ?? ref[2];
    if (next === undefined) throw new Error(`undefined token ${ref[1]}`);
    return parseColor(next, vars, new Set([...seen, ref[1]]));
  }
  if (NAMED[v.toLowerCase()]) return NAMED[v.toLowerCase()];
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = v.match(/^rgba?\((.+)\)$/i);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const mix = v.match(/^color-mix\((.+)\)$/i);
  if (mix) {
    const [space, a, b] = splitTop(mix[1]);
    if (space !== 'in srgb') throw new Error(`unsupported color-mix space: ${space}`);
    const pick = (part) => { const m = part.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/); return { c: m[1], p: m[2] === undefined ? undefined : Number(m[2]) / 100 }; };
    const x = pick(a);
    const y = pick(b);
    const px = x.p ?? (y.p === undefined ? 0.5 : 1 - y.p);
    const ca = parseColor(x.c, vars, seen);
    const cb = parseColor(y.c, vars, seen);
    // sRGB interpolation with premultiplied alpha, as the browser does.
    const alpha = ca[3] * px + cb[3] * (1 - px);
    if (alpha === 0) return [0, 0, 0, 0];
    const ch = (i) => (ca[i] * ca[3] * px + cb[i] * cb[3] * (1 - px)) / alpha;
    return [ch(0), ch(1), ch(2), alpha];
  }
  throw new Error(`cannot read colour "${v}"`);
}

const luminance = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// `top` painted over `under` (source-over); the result is opaque when `under` is.
const over = (top, under) => {
  const a = top[3] + under[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
};
const hexOf = ([r, g, b]) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// ── A small CSS reader: rules with their selector list, declarations, file and line ──
function readRules(file, text) {
  const rules = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  function walk(start, end) {
    let i = start;
    while (i < end) {
      const open = src.indexOf('{', i);
      const semi = src.indexOf(';', i);
      if (open === -1 || open >= end) return;
      if (semi !== -1 && semi < open && src.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue; }
      let depth = 1;
      let j = open + 1;
      while (j < end && depth) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
      const head = src.slice(i, open).trim();
      const headAt = i + src.slice(i, open).search(/\S/);
      if (head.startsWith('@media') || head.startsWith('@supports') || head.startsWith('@layer') || head.startsWith('@container')) walk(open + 1, j - 1);
      else if (!head.startsWith('@')) {
        const decls = [];
        for (const d of splitTop(src.slice(open + 1, j - 1), ';')) {
          const k = d.indexOf(':');
          if (k > 0) decls.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]);
        }
        rules.push({ file, line: lineAt(headAt), selectors: splitTop(head).map((s) => s.replace(/\s+/g, ' ')), decls });
      }
      i = j;
    }
  }
  walk(0, src.length);
  return rules;
}

function tokens(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const block = (sel) => {
    const at = src.search(new RegExp(`(^|[\\s}])${sel.replace('.', '\\.')} \\{`, 'm'));
    if (at === -1) throw new Error(`app/tailwind.css has no "${sel} {" token block`);
    const open = src.indexOf('{', at);
    let depth = 1;
    let end = open + 1;
    while (end < src.length && depth) { if (src[end] === '{') depth += 1; else if (src[end] === '}') depth -= 1; end += 1; }
    const body = src.slice(open + 1, end - 1);
    return new Map([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]));
  };
  const light = block(':root');
  const dark = new Map([...light, ...block('.dark')]);
  return { light, dark };
}

// ── The check ──
const FILL = /^var\(--rd-accent(?:-fill(?:-hover)?)?\)$/;
const MIX = /^color-mix\(.*var\(--rd-accent(?:-fill)?\)/;
const BARE = /^var\(--rd-accent\)$/;
const IMAGE = /^(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(|^url\(|^image-set\(/i;

// The crimson fill colour a background value paints, or null: every layer and every space-separated component is
// read, image layers (gradients, url()) are set aside, and the first component that is a fill token or a crimson
// color-mix wins (`var(--rd-accent) no-repeat`, `url(x), var(--rd-accent)` both paint the bare accent).
function fillColour(value) {
  for (const layer of splitTop(value)) {
    for (const part of splitTop(layer, ' ')) {
      if (!part || IMAGE.test(part)) continue;
      if (FILL.test(part) || MIX.test(part)) return part;
    }
  }
  return null;
}
const STATE = /:(?:hover|active|focus-visible|focus|checked)(?![\w-])|:not\([^()]*\)$/;

// The selector with its trailing state pseudo-classes removed, one at a time (`a:hover:not(:disabled)` → `a`).
function bases(selector) {
  const out = [];
  let s = selector;
  for (;;) {
    const m = s.match(/(:(?:hover|active|focus-visible|focus|checked|disabled)|:not\([^()]*(?:\([^()]*\))?[^()]*\))$/);
    if (!m) break;
    s = s.slice(0, -m[0].length);
    out.push(s);
  }
  return out;
}

// The selectors `selector` extends, most specific first: its ancestors dropped one compound at a time, and every
// subset of its last compound's simple selectors (attribute selectors, classes, ids, pseudo-classes, the type)
// taken off; pseudo-elements stay, and at least one other simple selector stays. The selector itself is not listed.
const SIMPLE = /::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|\[[^\]]*\]|[.#][\w-]+|[\w-]+|\*/g;
function compounds(selector) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      if (cur.trim()) out.push(cur.trim());
      if (ch !== ' ') out.push(ch);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const weight = (simple) => (simple.startsWith('#') ? 100 : simple.startsWith('::') || /^[\w-]|^\*/.test(simple) ? (simple === '*' ? 0 : 1) : 10);
function extended(selector) {
  const parts = compounds(selector);
  const lastAt = parts.length - 1;
  const simples = parts[lastAt].match(SIMPLE) ?? [];
  const fixed = simples.filter((s) => s.startsWith('::'));
  const free = simples.filter((s) => !s.startsWith('::'));
  const heads = [];
  for (let i = 0; i < lastAt; i += 1) {
    if (/^[>+~]$/.test(parts[i])) continue;
    heads.push(parts.slice(i, lastAt).join(' '));
  }
  heads.push('');
  const headWeight = (h) => compounds(h).filter((p) => !/^[>+~]$/.test(p)).flatMap((p) => p.match(SIMPLE) ?? []).reduce((n, s) => n + weight(s), 0);
  const out = new Map();
  for (const head of heads) {
    for (let mask = 1; mask < 1 << free.length; mask += 1) {
      const kept = free.filter((_, i) => mask & (1 << i));
      // A type selector goes first in a compound.
      kept.sort((a, b) => (/^[\w-]|^\*/.test(b) ? 1 : 0) - (/^[\w-]|^\*/.test(a) ? 1 : 0));
      const last = [...kept, ...fixed].join('');
      const sel = head ? `${head} ${last}`.replace(/ ([>+~]) $/, ' $1 ').replace(/\s+/g, ' ').trim() : last;
      if (sel === selector || out.has(sel)) continue;
      out.set(sel, headWeight(head) + [...kept, ...fixed].reduce((n, s) => n + weight(s), 0));
    }
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([sel]) => sel);
}
// Keyword values that name no colour of their own (the content comes from elsewhere): looked past.
const KEYWORD = /^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/i;

function check(sheets, themes, { requireOverlays = false, overlay = OVERLAY, glyph = GLYPH } = {}) {
  const rules = sheets.flatMap(({ file, text }) => readRules(file, text));
  const last = (selector, prop) => {
    let hit = null;
    for (const r of rules) if (r.selectors.includes(selector)) for (const [k, v] of r.decls) if (k === prop) hit = { value: v, at: `${r.file}:${r.line}` };
    return hit && KEYWORD.test(hit.value.replace(/\s*!important$/, '')) ? null : hit;
  };
  const bgOf = (r) => r.decls.filter(([k]) => k === 'background' || k === 'background-color').map(([, v]) => v.replace(/\s*!important$/, '')).pop();
  const fills = new Map();
  for (const r of rules) {
    const raw = bgOf(r);
    const bg = raw && fillColour(raw);
    if (!bg) continue;
    for (const sel of r.selectors) fills.set(sel, { bg, at: `${r.file}:${r.line}`, bare: BARE.test(bg) });
  }
  // State rules on a crimson fill: a background of any colour, or only a new `color` over the base's fill.
  for (const r of rules) {
    const raw = bgOf(r);
    const sets = raw !== undefined || r.decls.some(([k]) => k === 'color');
    if (!sets) continue;
    for (const sel of r.selectors) {
      if (fills.has(sel) || !STATE.test(sel)) continue;
      const base = bases(sel).find((b) => fills.has(b));
      if (!base) continue;
      const own = raw === undefined ? null : (fillColour(raw) ?? raw);
      const bg = own ?? fills.get(base).bg;
      fills.set(sel, { bg, at: own ? `${r.file}:${r.line}` : `${fills.get(base).at} (base), ${r.file}:${r.line}`, bare: BARE.test(bg), hoverOf: base, inherited: !own });
    }
  }
  // Variants of a crimson fill (an attribute selector, a class or a pseudo-class added, or an ancestor in front) that
  // set only a new `color`: the text changes on the fill they extend.
  for (const r of rules) {
    if (bgOf(r) !== undefined || !r.decls.some(([k]) => k === 'color')) continue;
    for (const sel of r.selectors) {
      if (fills.has(sel)) continue;
      const base = extended(sel).find((b) => fills.has(b));
      if (!base) continue;
      const from = fills.get(base);
      fills.set(sel, { bg: from.bg, at: `${from.at} (${base}), ${r.file}:${r.line}`, bare: from.bare, hoverOf: base, inherited: true });
    }
  }
  const lines = [];
  const failures = [];
  const measure = (sel, fill, c, backdrops, opacity) => {
    for (const [theme, vars] of Object.entries(themes)) {
      let worst = null;
      try {
        const fg = parseColor(c.value, vars);
        const paint = parseColor(fill.bg, vars);
        for (const b of backdrops) {
          const under = b ? parseColor(b, vars) : [255, 255, 255, 1];
          const bg = b ? over([paint[0], paint[1], paint[2], paint[3] * opacity], under) : paint;
          const top = over(fg, bg);
          const r = ratio(top, bg);
          if (!worst || r < worst.r) worst = { r, bg, top };
        }
      } catch (error) {
        failures.push(`${sel} ${theme}: ${error.message}`);
        lines.push(`FAIL  ${theme.padEnd(5)} ${sel} (${fill.at}): ${error.message}`);
        continue;
      }
      const min = c.kind === 'glyph' ? 3 : 4.5;
      const ok = worst.r >= min;
      lines.push(`${ok ? 'ok   ' : 'FAIL '} ${theme.padEnd(5)} ${worst.r.toFixed(2).padStart(5)}:1 ≥ ${min} ${c.kind.padEnd(5)} ${sel} — fill ${hexOf(worst.bg)} (${fill.at}) · ${c.what} ${hexOf(worst.top)} (${c.at})`);
      if (!ok) failures.push(`${sel} ${theme}: ${c.what} ${hexOf(worst.top)} on ${hexOf(worst.bg)} is ${worst.r.toFixed(2)}:1, needs ${min}:1`);
    }
  };
  for (const [sel, spec] of overlay) {
    const fill = fills.get(sel);
    if (!fill) {
      if (requireOverlays) failures.push(`overlay ${sel} is not a crimson fill in any sheet: update OVERLAY (${spec.why})`);
      continue;
    }
    if (fill.bare) { failures.push(`${sel} (${fill.at}) uses the bare var(--rd-accent) as a fill under content (${spec.why}): use var(--rd-accent-fill)`); continue; }
    const opacity = Number(last(sel, 'opacity')?.value ?? 1);
    for (const chain of spec.content) {
      const color = chain.map((s) => last(s, 'color')).find(Boolean);
      if (!color) { failures.push(`overlay ${sel}: no color found for ${chain.join(' / ')}`); continue; }
      measure(`${sel} under ${chain[0]}`, fill, { kind: 'text', what: `${chain[0]} color`, ...color }, spec.backdrops, opacity);
    }
  }
  for (const [sel, fill] of fills) {
    if (overlay.has(sel)) continue;
    if (ALLOWLIST.has(sel)) { lines.push(`allow ${sel} (${fill.at}): ${ALLOWLIST.get(sel)}`); continue; }
    if (fill.inherited && ALLOWLIST.has(fill.hoverOf)) { lines.push(`allow ${sel} (${fill.at}): a state of ${fill.hoverOf} — ${ALLOWLIST.get(fill.hoverOf)}`); continue; }
    if (/:disabled/.test(sel.replace(/:not\([^()]*\)/g, ''))) { lines.push(`skip  ${sel} (${fill.at}): disabled state, drawn at half strength`); continue; }
    const own = [sel, ...bases(sel)];
    const lookup = (chain) => {
      const found = [];
      const color = chain.map((s) => last(s, 'color')).find(Boolean);
      if (color) found.push({ kind: chain.some((s) => glyph.has(s)) ? 'glyph' : 'text', what: 'color', ...color });
      const stroke = chain.map((s) => last(`${s} svg`, 'stroke')).find(Boolean);
      if (stroke) found.push({ kind: 'glyph', what: 'svg stroke', ...stroke });
      const mark = chain.map((s) => last(`${s}::before`, 'background') ?? last(`${s}::before`, 'background-color')).find(Boolean);
      if (mark) found.push({ kind: 'glyph', what: '::before', ...mark });
      return found;
    };
    let content = lookup(own);
    // Nothing set on the selector or its state bases: the content it inherits from the selectors it extends.
    if (!content.length) {
      const wider = [...new Set(own.flatMap((s) => extended(s)))].filter((s) => !own.includes(s));
      content = lookup(wider).map((c) => ({ ...c, at: `${c.at}, extended` }));
    }
    if (fill.bare) {
      failures.push(`${sel} (${fill.at}) uses the bare var(--rd-accent) as a fill${content.length ? ` under content (${content.map((c) => `${c.what} ${c.at}`).join(', ')}): use var(--rd-accent-fill) and var(--rd-on-accent)` : ': put it on the allowlist with its reason, or use var(--rd-accent-fill)'}`);
      continue;
    }
    if (!content.length) {
      failures.push(`${sel} (${fill.at}) is a crimson fill whose content cannot be found (no color, svg stroke or ::before on it, its states or the selectors it extends): give it var(--rd-on-accent), or put it on the allowlist with its reason`);
      lines.push(`FAIL  ${sel} (${fill.at}): no content found on it`);
      continue;
    }
    for (const c of content) measure(sel, fill, c, [null], 1);
  }
  return { lines, failures, count: fills.size };
}

function sheetsInOrder() {
  return [{ file: relative(web, SHEET), text: readFileSync(SHEET, 'utf8') }];
}

const themes = tokens(readFileSync(SHEET, 'utf8'));

if (process.argv.includes('--self-test')) {
  // Each case: a sheet, and whether the check must fail on it.
  const ART = '.gauth-art { background: radial-gradient(90% 70% at 30% 70%, color-mix(in srgb, var(--rd-accent) 22%, transparent), transparent 70%), var(--rd-login-room); color: var(--rd-login-ink); }';
  const BTN = '.ui-btn { color: var(--rd-ink); } .ui-btn.ui-btn-primary { background-color: var(--rd-accent-fill); color: var(--rd-on-accent); }';
  const cases = [
    ['bare fill with text', true, '.p09-x { background: var(--rd-accent); color: var(--rd-on-accent); }'],
    ['fill token with text', false, '.p09-x { background: var(--rd-accent-fill); color: var(--rd-on-accent); }'],
    ['hover back to the bare accent', true, '.p09-x { background: var(--rd-accent-fill); color: var(--rd-on-accent); } .p09-x:hover { background: var(--rd-accent); }'],
    ['bare fill in a shorthand with a second component', true, '.p09-x { background: var(--rd-accent) no-repeat; color: #fff; }'],
    ['bare fill as the colour layer after an image layer', true, '.p09-x { background: url(x.png) no-repeat, var(--rd-accent); color: #fff; }'],
    ['bare background-color inside @media', true, '@media (max-width: 640px) { .p09-x { background-color: var(--rd-accent); color: #fff; } }'],
    ['hover that changes only the text colour to the accent', true, '.p09-x { background: var(--rd-accent-fill); color: var(--rd-on-accent); } .p09-x:hover { color: var(--rd-accent); }'],
    ['translucent text on the fill', true, '.p09-x { background: var(--rd-accent-fill); color: rgba(255, 255, 255, 0.5); }'],
    ['crimson glow inside a gradient is not a fill', false, ART],
    ['art line at 72% over the tag', true, `${ART} .gauth-art p { color: rgba(245, 245, 242, 0.72); } .gauth-art-tag { background: var(--rd-accent-fill); opacity: 0.88; }`],
    ['art tag on the bare accent', true, `${ART} .gauth-art-tag { background: var(--rd-accent); opacity: 0.88; }`],
    ['art heading and line in the art ink over the tag', false, `${ART} .gauth-art-tag { background: var(--rd-accent-fill); opacity: 0.88; }`],
    ['pressed variant (attribute selector) on a light fill, text inherited', true, `${BTN} .ui-btn.ui-btn-primary[aria-pressed='true'] { background-color: color-mix(in srgb, var(--rd-accent-fill) 60%, #fff); }`],
    ['variant with an extra class on a light fill, text inherited', true, '.p09-day { color: var(--rd-ink); } .p09-day.on { background: var(--rd-accent-fill); color: var(--rd-on-accent); } .p09-day.on.on-x { background: color-mix(in srgb, var(--rd-accent-fill) 50%, #fff); }'],
    ['variant under an ancestor on a light fill, text inherited', true, `${BTN} .dialog .ui-btn.ui-btn-primary { background-color: color-mix(in srgb, var(--rd-accent-fill) 60%, #fff); }`],
    ['variant that sets only the text colour to the accent', true, `${BTN} .ui-btn.ui-btn-primary[aria-pressed='true'] { color: var(--rd-accent); }`],
    ['fill with no content of its own and off the allowlist', true, '.p09-x { background: var(--rd-accent-fill); }'],
    ['pressed variant on the hover fill, text inherited', false, `${BTN} .ui-btn.ui-btn-primary[aria-pressed='true'] { background-color: var(--rd-accent-fill-hover); }`],
  ];
  let wrong = 0;
  for (const [name, mustFail, text] of cases) {
    const { failures } = check([{ file: 'self-test.css', text }], themes, { overlay: ART_OVERLAY });
    const ok = mustFail ? failures.length > 0 : failures.length === 0;
    if (!ok) wrong += 1;
    console.log(`${ok ? 'ok   ' : 'WRONG'} ${name}: ${failures.length ? `fails — ${failures[0]}` : 'passes'} (${mustFail ? 'must fail' : 'must pass'})`);
  }
  process.exit(wrong ? 1 : 0);
}

const { lines, failures, count } = check(sheetsInOrder(), themes, { requireOverlays: true });
for (const pair of [['--rd-on-accent', '--rd-accent-fill'], ['--rd-on-accent', '--rd-accent-fill-hover']]) {
  for (const [theme, vars] of Object.entries(themes)) {
    let fg;
    let bg;
    try { fg = parseColor(`var(${pair[0]})`, vars); bg = parseColor(`var(${pair[1]})`, vars); } catch (error) {
      console.log(`FAIL  ${theme.padEnd(5)} token ${pair[0]} on ${pair[1]}: ${error.message}`);
      failures.push(`${pair[0]} on ${pair[1]} ${theme}: ${error.message}`);
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= 4.5;
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${theme.padEnd(5)} ${r.toFixed(2).padStart(5)}:1 ≥ 4.5 token ${pair[0]} on ${pair[1]} (${hexOf(bg)})`);
    if (!ok) failures.push(`${pair[0]} on ${pair[1]} ${theme}: ${r.toFixed(2)}:1`);
  }
}
for (const line of lines) console.log(line);
console.log(`\n${count} crimson-fill selectors read.`);
if (failures.length) {
  console.error(`\ncontrast: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('contrast: every pair on a crimson fill passes in both themes.');
