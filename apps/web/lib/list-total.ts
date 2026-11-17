import type { Copy } from './copy';

/**
 * A list's total as a screen shows it (database plan DB.8). The API counts a list up to 10,000 and answers
 * `totalCapped: true` when there are more; the screen then reads «أكثر من 10,000» / "More than 10,000" /
 * «יותר מ־10,000», the number grouped as the pager groups it. An answer without `totalCapped` (the Playwright
 * mocks, an older API) is not capped. Under the cap the count is drawn by `format`, as the screen drew it before.
 */
export function listTotal(t: Copy, total: number, capped: boolean | undefined, format: (value: number) => string = String): string {
  return capped ? t.moreThan.replace('{n}', total.toLocaleString('en-US')) : format(total);
}
