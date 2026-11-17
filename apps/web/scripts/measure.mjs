// The CI measurement job's report (speed plan PF.14, spec decision 15). It only reads files and prints Markdown for
// the job summary; it measures nothing itself and never fails the job on a number.
//
//   node scripts/measure.mjs bundle [distDir]             the production build: first-load JS a route, the largest
//                                                          chunks, the stylesheets and the fonts (from apps/web)
//   node scripts/measure.mjs lighthouse <name=report.json>… Lighthouse's LCP, TBT, CLS and transfer size a page
//
// Next 16 prints no sizes in `next build`; with Turbopack it writes `<distDir>/diagnostics/route-bundle-stats.json`
// (`firstLoadUncompressedJsBytes` and the chunk paths a route loads first), which `bundle` reads. Gzip sizes are
// worked out here with the default level, near what a browser receives from `next start`'s compression.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const gzipped = new Map();
const gzipOf = (path) => {
  if (!gzipped.has(path)) gzipped.set(path, gzipSync(readFileSync(path)).length);
  return gzipped.get(path);
};

function filesUnder(dir, keep) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path, keep) : keep(name) ? [path] : [];
  });
}

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map((_, index) => (index === 0 ? '---' : '---:')).join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function bundle(distDir = '.next') {
  const out = ['## Production build (apps/web)', ''];
  let routes = [];
  try {
    routes = JSON.parse(readFileSync(join(distDir, 'diagnostics', 'route-bundle-stats.json'), 'utf8'));
  } catch {
    out.push(`No \`${distDir}/diagnostics/route-bundle-stats.json\`: the build did not write its route sizes.`, '');
  }
  if (routes.length) {
    out.push('### First-load JS a route', '', 'Every JS file a route loads before it is interactive (its segments and the shared runtime).', '');
    out.push(
      table(
        ['Route', 'Uncompressed', 'Gzip', 'Files'],
        routes.map((row) => {
          const gzip = row.firstLoadChunkPaths.reduce((sum, path) => {
            try {
              return sum + gzipOf(path);
            } catch {
              return sum;
            }
          }, 0);
          return [`\`${row.route}\``, kb(row.firstLoadUncompressedJsBytes), kb(gzip), String(row.firstLoadChunkPaths.length)];
        }),
      ),
      '',
    );
    // The files every route loads: in the first-load list of all of them.
    const shared = routes.map((row) => new Set(row.firstLoadChunkPaths)).reduce((all, files) => new Set([...all].filter((path) => files.has(path))));
    const sharedBytes = [...shared].reduce((sum, path) => sum + statSync(path).size, 0);
    const sharedGzip = [...shared].reduce((sum, path) => sum + gzipOf(path), 0);
    out.push(`Shared by every route: ${shared.size} files, ${kb(sharedBytes)} (${kb(sharedGzip)} gzip).`, '');
  }
  const chunks = filesUnder(join(distDir, 'static'), (name) => name.endsWith('.js')).map((path) => ({ path, size: statSync(path).size }));
  chunks.sort((a, b) => b.size - a.size);
  const total = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  out.push(`### The 15 largest of ${chunks.length} JS chunks (${kb(total)} in all)`, '');
  out.push(table(['Chunk', 'Uncompressed', 'Gzip'], chunks.slice(0, 15).map((chunk) => [`\`${relative(distDir, chunk.path)}\``, kb(chunk.size), kb(gzipOf(chunk.path))])), '');
  const sheets = filesUnder(join(distDir, 'static'), (name) => name.endsWith('.css'));
  out.push('### Stylesheets', '');
  out.push(sheets.length ? table(['Sheet', 'Uncompressed', 'Gzip'], sheets.map((path) => [`\`${relative(distDir, path)}\``, kb(statSync(path).size), kb(gzipOf(path))])) : 'None found.', '');
  const fonts = filesUnder(join(distDir, 'static', 'media'), (name) => /\.(woff2?|ttf|otf)$/.test(name));
  const preloaded = fonts.filter((path) => /\.p\./.test(path));
  out.push(`### Fonts: ${fonts.length} files, ${kb(fonts.reduce((sum, path) => sum + statSync(path).size, 0))}; ${preloaded.length} marked for preload, \`.p.\` in the name (${kb(preloaded.reduce((sum, path) => sum + statSync(path).size, 0))})`, '');
  return out.join('\n');
}

const AUDITS = [
  ['LCP', 'largest-contentful-paint', (value) => `${(value / 1000).toFixed(2)} s`],
  ['TBT', 'total-blocking-time', (value) => `${Math.round(value)} ms`],
  ['CLS', 'cumulative-layout-shift', (value) => value.toFixed(3)],
  ['FCP', 'first-contentful-paint', (value) => `${(value / 1000).toFixed(2)} s`],
  ['Transfer', 'total-byte-weight', (value) => kb(value)],
];

function lighthouse(pairs) {
  const out = ['## Lighthouse (next start + the mock API)', ''];
  const rows = pairs.map((pair) => {
    const [name, path] = pair.split('=');
    try {
      const report = JSON.parse(readFileSync(path, 'utf8'));
      if (report.runtimeError) return [name, `failed: ${report.runtimeError.code}`, ...AUDITS.slice(1).map(() => ''), ''];
      const requests = report.audits['network-requests']?.details?.items?.length;
      const cells = AUDITS.map(([, id, format]) => {
        const value = report.audits[id]?.numericValue;
        return typeof value === 'number' ? format(value) : 'n/a';
      });
      return [`${name} (\`${new URL(report.finalDisplayedUrl ?? report.finalUrl).pathname}\`)`, ...cells, requests === undefined ? 'n/a' : String(requests)];
    } catch (error) {
      return [name, `no report (${error.code ?? error.message})`, ...AUDITS.slice(1).map(() => ''), ''];
    }
  });
  out.push(table(['Page', ...AUDITS.map(([label]) => label), 'Requests'], rows), '');
  out.push('Lighthouse defaults: a mid-range phone on a slow 4G line, simulated. The API is the e2e mock, so the figures measure the web, not the server.', '');
  return out.join('\n');
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'bundle') console.log(bundle(rest[0]));
else if (command === 'lighthouse') console.log(lighthouse(rest));
else {
  console.error('usage: measure.mjs bundle [distDir] | lighthouse <name=report.json>…');
  process.exit(2);
}
