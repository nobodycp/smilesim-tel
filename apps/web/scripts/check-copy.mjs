// Fails (exit 1) when the interface text and the API error codes drift apart.
//
//   1. an API error code (apps/api/src/errors.ts) has no text in ar, en or he;
//   2. the Arabic text of a code differs from the message the API sends;
//   3. a key exists in one language and not in another, or a {placeholder} differs;
//   4. a key is not used by any file under app, components, lib or tests.
//
// Run: node scripts/check-copy.mjs   (npm run check:copy in apps/web)

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const errorsFile = join(web, '..', 'api', 'src', 'errors.ts');
const require = createRequire(import.meta.url);
const ts = require('typescript');

// Codes the web app raises itself, in lib/api.ts, when there is no answer to read one from.
const CLIENT_CODES = ['NETWORK', 'GENERIC'];
const LANGUAGES = ['ar', 'en', 'he'];

const problems = [];
const fail = (message) => problems.push(message);

// Reads a .ts file that only exports plain data and has no runtime imports.
function load(file, exportName) {
  const source = readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', js)(loaded, loaded.exports);
  const value = loaded.exports[exportName];
  if (!value) throw new Error(`${relative(web, file)} does not export ${exportName}`);
  return value;
}

// ERROR_MESSAGES in apps/api/src/errors.ts, one `CODE: 'message',` per line.
function apiErrors() {
  const text = readFileSync(errorsFile, 'utf8');
  const block = /export const ERROR_MESSAGES = \{([\s\S]*?)\n\} as const;/.exec(text);
  if (!block) throw new Error('ERROR_MESSAGES not found in apps/api/src/errors.ts');
  const entries = [...block[1].matchAll(/^\s+([A-Z][A-Z_]*): '((?:[^'\\]|\\.)*)',$/gm)];
  if (entries.length === 0) throw new Error('ERROR_MESSAGES has no entries the check can read');
  return new Map(entries.map((entry) => [entry[1], entry[2].replace(/\\(.)/g, '$1')]));
}

// "a.b.c" for every string in a nested object.
function flatten(object, prefix = '') {
  const out = new Map();
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') for (const [inner, text] of flatten(value, path)) out.set(inner, text);
    else out.set(path, value);
  }
  return out;
}

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.(tsx?|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

const copies = Object.fromEntries(LANGUAGES.map((lang) => [lang, load(join(web, 'lib', 'copy', `${lang}.ts`), lang)]));
const flat = Object.fromEntries(LANGUAGES.map((lang) => [lang, flatten(copies[lang])]));
const codes = apiErrors();

// 1 and 2: every API code is translated once, and Arabic is the API's own sentence.
for (const lang of LANGUAGES) {
  const errors = copies[lang].errors ?? {};
  for (const [code, message] of codes) {
    const text = errors[code];
    if (typeof text !== 'string' || !text.trim()) fail(`error code ${code} has no ${lang} text (lib/copy/${lang}.ts, errors.${code})`);
    else if (lang === 'ar' && text !== message) fail(`error code ${code}: ar text differs from the API message "${message}"`);
  }
  const known = new Set([...codes.keys(), ...CLIENT_CODES]);
  for (const key of Object.keys(errors)) {
    if (!known.has(key)) fail(`lib/copy/${lang}.ts has errors.${key}, which is neither an API error code nor a client code`);
  }
  for (const code of CLIENT_CODES) {
    if (typeof errors[code] !== 'string' || !errors[code].trim()) fail(`client code ${code} has no ${lang} text`);
  }
}

// 3: the same keys, with the same placeholders, in every language.
for (const lang of LANGUAGES.filter((item) => item !== 'ar')) {
  for (const key of flat.ar.keys()) {
    if (!flat[lang].has(key)) fail(`key ${key} is missing in ${lang}`);
    else if (!String(flat[lang].get(key)).trim()) fail(`key ${key} is empty in ${lang}`);
    else if (placeholders(flat[lang].get(key)) !== placeholders(flat.ar.get(key))) fail(`key ${key}: placeholders differ between ar and ${lang}`);
  }
  for (const key of flat[lang].keys()) {
    if (!flat.ar.has(key)) fail(`key ${key} exists in ${lang} and not in ar`);
  }
}

// 4: nothing unused. Copy keys are looked for by name in the app; a client code in lib/api.ts.
const files = ['app', 'components', 'lib', 'tests']
  .flatMap((dir) => sourceFiles(join(web, dir)))
  .filter((file) => !relative(join(web, 'lib'), file).startsWith('copy'));
const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
for (const key of Object.keys(copies.ar)) {
  if (key === 'errors') continue;
  if (!new RegExp(`\\b${key}\\b`).test(text)) fail(`key ${key} is not used by any file under app, components, lib or tests`);
}
const api = readFileSync(join(web, 'lib', 'api.ts'), 'utf8');
for (const code of CLIENT_CODES) {
  if (!api.includes(`'${code}'`)) fail(`client code ${code} is not raised in lib/api.ts`);
}

if (problems.length > 0) {
  console.error(`check-copy: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-copy: ok (${flat.ar.size} keys in ${LANGUAGES.length} languages, ${codes.size} API codes, ${CLIENT_CODES.length} client codes)`);
