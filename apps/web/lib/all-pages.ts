import type { ApiResult, Page } from './api-types';

// The API serves every list one bounded page at a time. A screen that needs a short list whole (the name map, an
// account picker, a report that sorts and sums its rows) reads the pages one after another, up to this many.
const MAX_PAGES = 50;

/** Every row of a paged list, with the first answer beside them for the list's own extra keys (totals). */
export async function allPages<Answer extends Page<unknown>>(
  read: (cursor: string | null) => Promise<ApiResult<Answer>>,
): Promise<ApiResult<{ rows: Answer['items']; first: Answer }>> {
  const rows: Answer['items'] = [];
  let first: Answer | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await read(cursor);
    if (!result.ok) return result;
    first ??= result.data;
    rows.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (!cursor) break;
  }
  return { ok: true, status: 200, data: { rows, first: first as Answer } };
}
