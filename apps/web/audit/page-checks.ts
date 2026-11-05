import type { Page } from '@playwright/test';

/** Latin words a reader sees in the Arabic office on purpose. */
const ALLOWED_LATIN = new Set(['SIM', 'eSIM', 'GB', 'ICCID', 'SMS', 'EN']);

export type PageReport = {
  name: string;
  url: string;
  errors: string[];
  dir: string;
  lang: string;
  pageScroll: boolean;
  wideSheets: string[];
  clipped: string[];
  unnamed: string[];
  latin: string[];
  nav: string[];
  nextIssues: string;
};

/** Collects console errors and page errors from now on; read the array after the page settles. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} from ${new URL(response.url()).pathname}`);
  });
  return errors;
}

/** Reads the rendered page and returns every visual and wording problem the audit looks for. */
export async function inspect(page: Page, name: string, errors: string[]): Promise<PageReport> {
  const found = await page.evaluate((allowed) => {
    const describe = (el: Element) => {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const cls = el.getAttribute('class') ?? '';
      return `${el.tagName.toLowerCase()}${cls ? `.${cls.split(' ').filter(Boolean).join('.')}` : ''} "${text}"`;
    };
    const visible = (el: Element) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const root = document.scrollingElement ?? document.documentElement;

    const wideSheets = [...document.querySelectorAll('.sheet, .canvas, .pane')]
      .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 1)
      .map(describe);

    const clipped = [...document.querySelectorAll('main td, main th, main button, main a, main h1, main h2, main h3, main strong, main .badge, main label, main dd, main dt, main p, .side-nav a, .topbar button')]
      .filter((el) => {
        if (!visible(el)) return false;
        const html = el as HTMLElement;
        const style = getComputedStyle(html);
        const hides = style.overflowX !== 'visible' || style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap';
        return hides && html.scrollWidth > html.clientWidth + 1 && html.clientWidth > 0;
      })
      .map(describe);

    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
      if (aria.trim()) return aria;
      const labelled = el.getAttribute('aria-labelledby');
      if (labelled) return labelled.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const wrap = el.closest('label')?.textContent ?? '';
        const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '' : '';
        const holder = el instanceof HTMLSelectElement ? '' : el.placeholder;
        return `${wrap}${byFor}${holder}`;
      }
      const alt = [...el.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt')).join(' ');
      return `${el.textContent ?? ''}${alt}`;
    };
    const unnamed = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="menuitem"]')]
      .filter((el) => visible(el) && !el.closest('nextjs-portal') && !nameOf(el).trim())
      .map(describe);

    const latin: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const skip = 'bdi, input, textarea, select, script, style, noscript, svg, code, kbd, [dir="ltr"], nextjs-portal, [aria-hidden="true"]';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(skip) || !visible(parent)) continue;
      for (const word of (node.textContent ?? '').match(/[A-Za-z][A-Za-z_]*/g) ?? []) {
        if (!allowed.includes(word)) latin.push(`${word} in ${describe(parent)}`);
      }
    }

    const nav = [...document.querySelectorAll('.side-nav a.nav-link')].filter(visible).map((el) => (el.textContent ?? '').trim() || el.getAttribute('title') || '');
    const portal = document.querySelector('nextjs-portal');
    const badge = portal?.shadowRoot?.querySelector('[data-issues-count]');
    const count = (badge?.textContent ?? '').match(/\d+/)?.[0] ?? '';
    const dialog = portal?.shadowRoot?.querySelector('[data-nextjs-dialog-overlay]');
    const issues = count && count !== '0' ? `${count} issue(s)` : dialog ? 'error overlay open' : '';

    return {
      dir: document.documentElement.getAttribute('dir') ?? '',
      lang: document.documentElement.getAttribute('lang') ?? '',
      pageScroll: root.scrollWidth > window.innerWidth + 1,
      wideSheets,
      clipped: [...new Set(clipped)],
      unnamed: [...new Set(unnamed)],
      latin: [...new Set(latin)],
      nav,
      nextIssues: issues,
    };
  }, [...ALLOWED_LATIN]);
  return { name, url: page.url(), errors: [...errors], ...found };
}

export function problems(report: PageReport, expectedNav?: string[]): string[] {
  const list: string[] = [];
  for (const error of report.errors) list.push(`console: ${error}`);
  if (report.nextIssues) list.push(`next overlay: ${report.nextIssues}`);
  if (report.dir !== 'rtl') list.push(`dir is "${report.dir}"`);
  if (report.lang !== 'ar') list.push(`lang is "${report.lang}"`);
  if (report.pageScroll) list.push('the page scrolls sideways');
  for (const item of report.wideSheets) list.push(`overflows sideways: ${item}`);
  for (const item of report.clipped) list.push(`clipped: ${item}`);
  for (const item of report.unnamed) list.push(`no accessible name: ${item}`);
  for (const item of report.latin) list.push(`latin text: ${item}`);
  if (expectedNav && report.nav.join(' | ') !== expectedNav.join(' | ')) {
    list.push(`side menu is [${report.nav.join(' | ')}], expected [${expectedNav.join(' | ')}]`);
  }
  return list;
}
