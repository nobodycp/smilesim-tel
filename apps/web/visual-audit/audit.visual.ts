import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.WEB_PORT ?? '3000';
const door = process.env.DOOR ?? 'admin';
const user = process.env.USER_LOGIN ?? 'branch';
const OUT = join(__dirname, '../audit-output/visual-audit', process.env.RUN ?? 'latest');
const widths = (process.env.WIDTHS ?? '390,768,1280').split(',').map(Number);
const combos = (process.env.COMBOS ?? 'ar-dark,en-light').split(',');
const only = process.env.ONLY;

const ROUTES = [
  '/', '/numbers', '/numbers/:line', '/users', '/users/main', '/users/pos', '/tasks', '/tasks/:task', '/packages',
  '/companies', '/companies/:company', '/companies/:company/packages/:package', '/providers', '/providers/sky',
  '/provider-accounts', '/provider-accounts/sky', '/finance', '/profits', '/reports/balances', '/reports/supply',
  '/provider-operations', '/audit', '/notices', '/settings', '/wallet', '/offers', '/roles', '/branding',
];

type Finding = { route: string; view: string; width: number; combo: string; kind: string; detail: string };

async function get(page: Page, url: string, path: string) {
  const res = await page.request.get(`${url}/api${path}`, { headers: { 'x-door': `${door}.localhost:${PORT}` } });
  return res.ok() ? res.json() : {};
}

// What the eye misses in a thumbnail: sideways scroll, boxes past the edge, clipped text, small tap targets on a
// phone, tiny text, and controls drawn by the browser instead of the system.
async function inspect(page: Page, width: number) {
  return page.evaluate((w) => {
    const out: { kind: string; detail: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    if (over > 0) out.push({ kind: 'hscroll', detail: `${over}px` });
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')}`;
    const clipped = (el: Element) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return true; } return false; };
    const root = document.querySelector('.canvas') ?? document.body;
    const seen = new Set<string>();
    const push = (kind: string, detail: string) => { const k = kind + detail; if (!seen.has(k)) { seen.add(k); out.push({ kind, detail }); } };
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || el.closest('.sr-only')) continue;
      if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) push('past-edge', name(el));
      const he = el as HTMLElement;
      if (he.children.length === 0 && he.textContent?.trim()) {
        if (he.scrollWidth > he.clientWidth + 2 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis') push('clipped-text', `${name(el)} «${he.textContent.trim().slice(0, 30)}»`);
        if (parseFloat(s.fontSize) < 11 && !el.matches('.cur')) push('tiny-text', `${name(el)} ${s.fontSize}`);
      }
      if (w < 768 && el.matches('button, a[href], [role=tab], [role=radio], [role=switch], select, input:not([type=hidden])') && !el.closest('table') && (r.height < 32 || r.width < 32) && s.opacity !== '0') push('small-target', `${name(el)} ${Math.round(r.width)}x${Math.round(r.height)} «${(he.innerText || he.getAttribute('aria-label') || '').trim().slice(0, 20)}»`);
      if (el.matches('select:not(.ui-select-field), input[type=checkbox]:not([style*="opacity"])') && s.opacity !== '0' && s.appearance !== 'none') push('native-control', name(el));
    }
    return out;
  }, width);
}

for (const combo of combos) {
  test(`audit ${door} ${combo}`, async ({ page, context }) => {
    const [locale, theme] = combo.split('-');
    const url = `http://${door}.localhost:${PORT}`;
    mkdirSync(OUT, { recursive: true });
    await context.addCookies([{ name: 'smilesim-locale', value: locale, url }, { name: 'smilesim-theme', value: theme, url }]);
    await page.request.post(`${url}/api/auth/login`, { headers: { 'x-door': `${door}.localhost:${PORT}`, 'content-type': 'application/json' }, data: JSON.stringify({ loginName: user, password: '123456' }) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const shelf = await get(page, url, '/office/companies');
    const cellcom = (shelf.companies ?? []).find((c: { code: string }) => c.code === 'cellcom');
    const ids = {
      line: (await get(page, url, '/office/lines')).items?.[0]?.id ?? 'x',
      task: (await get(page, url, '/office/tasks')).items?.[0]?.id ?? 'x',
      company: 'cellcom',
      package: cellcom?.providers?.flatMap((p: { packages: { code: string }[] }) => p.packages)?.[0]?.code ?? 'x',
    };
    const findings: Finding[] = [];
    for (const raw of ROUTES) {
      if (only && !raw.includes(only)) continue;
      const path = raw.replace(':line', ids.line).replace(':task', ids.task).replace(':company', ids.company).replace(':package', ids.package);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url + path);
        await page.waitForTimeout(1200);
        const tabs = await page.locator('.canvas [role=tablist]').first().locator('[role=tab]').count().catch(() => 0);
        for (let i = 0; i < Math.max(1, tabs); i += 1) {
          let view = 'main';
          if (tabs > 0) {
            const tab = page.locator('.canvas [role=tablist]').first().locator('[role=tab]').nth(i);
            view = `tab${i}`;
            if (i > 0) { await tab.click().catch(() => {}); await page.waitForTimeout(700); }
          }
          for (const f of await inspect(page, width)) findings.push({ route: raw, view, width, combo, ...f });
          const tall = await page.evaluate(() => { const c = document.querySelector('.canvas'); return c ? c.scrollHeight + 80 : document.body.scrollHeight; });
          await page.setViewportSize({ width, height: Math.max(900, Math.min(tall, 6000)) });
          await page.waitForTimeout(200);
          const slug = raw.replace(/[/:]/g, '_').replace(/^_/, '') || 'home';
          await page.screenshot({ path: join(OUT, `${door}-${slug}-${view}-${combo}-${width}.png`) });
          await page.setViewportSize({ width, height: 900 });
        }
      }
    }
    writeFileSync(join(OUT, `findings-${door}-${combo}.json`), JSON.stringify(findings, null, 1));
  });
}
