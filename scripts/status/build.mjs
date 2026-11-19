#!/usr/bin/env node
// Builds the owner's one status page, docs/status/index.html (Arabic, self-contained, opens from the file system).
// Two sources: the checkboxes of the plan files named in docs/status/status.json (so ticking a slice is the only
// bookkeeping), and that file's hand-kept half (axes, Arabic labels, items outside the plans, open decisions, what
// was checked). Run from the repo root after a plan or status.json changes: `node scripts/status/build.mjs`.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLANS = join(ROOT, 'docs/superpowers/plans');
const status = JSON.parse(readFileSync(join(ROOT, 'docs/status/status.json'), 'utf8'));

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

/** A plan's checkbox items: done or not, the slice id when the title starts with one, the bold title, the hashes. */
function itemsOf(file) {
  const lines = readFileSync(join(PLANS, file), 'utf8').split('\n');
  const items = [];
  lines.forEach((line, index) => {
    const hit = /^\s*- \[( |x)\] (.*)$/.exec(line);
    if (!hit) return;
    const text = hit[2];
    const bold = /\*\*(.+?)(\*\*|$)/.exec(text);
    const title = (bold ? bold[1] : text).replace(/[`*]/g, '').replace(/[.:]\s*$/, '').trim();
    const id = /^([A-Z]{1,3}\.\d+[a-z]?)\b/.exec(title)?.[1] ?? null;
    const rest = lines.slice(index, index + 6).join(' ');
    const hashes = hit[1] === 'x' ? [...new Set(rest.slice(0, 700).match(/\b[0-9a-f]{8}\b/g) ?? [])].slice(0, 4) : [];
    items.push({ done: hit[1] === 'x', id, title: title.slice(0, 140), hashes });
  });
  return items;
}

const labelOf = (item) => {
  if (item.id) return status.labels[item.id] ?? null;
  const key = Object.keys(status.labels).find((k) => item.title.startsWith(k));
  return key ? status.labels[key] : null;
};

const groups = status.plans.map((plan) => {
  const items = itemsOf(plan.file)
    .filter((item) => !(plan.skip ?? []).some((s) => item.title.startsWith(s)))
    .map((item) => {
      const label = labelOf(item);
      const state = item.done ? 'done' : (label?.state ?? plan.state ?? 'todo');
      return { id: item.id, en: item.title, ar: label?.ar ?? null, state, hashes: item.hashes };
    });
  return { name: plan.name, axis: plan.axis, file: `docs/superpowers/plans/${plan.file}`, note: plan.note ?? null, items };
});
for (const axis of status.axes) {
  const items = status.extra.filter((e) => e.axis === axis.id).map((e) => ({ id: null, en: null, ar: e.ar, state: e.state, hashes: [] }));
  if (items.length) groups.push({ name: `${axis.name}: خارج ملفات الخطط`, axis: axis.id, file: 'docs/status/status.json', note: null, items });
}

const known = new Set(status.plans.map((p) => p.file));
const unlisted = readdirSync(PLANS).filter((f) => f.endsWith('.md') && !known.has(f));
if (unlisted.length) console.warn(`plans not in status.json: ${unlisted.join(', ')}`);

const count = (dir, test) => {
  let n = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(join(d, entry.name));
      else if (test(entry.name)) n += 1;
    }
  };
  walk(join(ROOT, dir));
  return n;
};

const data = {
  updated: status.updated,
  built: new Date().toISOString().slice(0, 16).replace('T', ' '),
  states: status.states,
  axes: status.axes,
  groups,
  decisions: status.decisions,
  checks: status.checks,
  facts: {
    head: git('rev-parse', '--short=8', 'HEAD'),
    commits: Number(git('rev-list', '--count', 'HEAD')) || 0,
    unpushed: Number(git('rev-list', '--count', 'origin/main..HEAD')) || 0,
    apiSpecs: count('apps/api/src', (n) => n.endsWith('.spec.ts')),
    webSpecs: count('apps/web/tests', (n) => n.endsWith('.spec.ts')),
    migrations: readdirSync(join(ROOT, 'apps/api/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length,
    adrs: readdirSync(join(ROOT, 'docs/architecture/decisions')).filter((f) => /^\d{4}-/.test(f)).length,
    // A business line's folder (`postpaid/`) holds its modules (slice F.7e): each of them counts, not the folder.
    modules: readdirSync(join(ROOT, 'apps/api/src/modules'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'testing')
      .reduce((n, e) => n + (e.name === 'postpaid' ? readdirSync(join(ROOT, 'apps/api/src/modules', e.name), { withFileTypes: true }).filter((d) => d.isDirectory()).length : 1), 0),
  },
};

const template = readFileSync(join(ROOT, 'scripts/status/page.html'), 'utf8');
const json = JSON.stringify(data).replace(/</g, '\\u003c');
writeFileSync(join(ROOT, 'docs/status/index.html'), template.replace('/*DATA*/null', () => json));
const all = groups.flatMap((g) => g.items);
console.log(`docs/status/index.html: ${all.filter((i) => i.state === 'done').length} of ${all.length} items done, ${groups.length} groups`);
