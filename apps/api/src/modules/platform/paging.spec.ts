import { ApiFailure } from './api-failure';
import { TOTAL_CAP, after, cappedTotal, countUpTo, cursorPosition, decodeCursor, encodeCursor, encodeKeyCursor, capList, keyCursor, keyPage, page } from './paging';

const at = (second: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, second));
const row = (id: string, second: number) => ({ id, createdAt: at(second) });

describe('the list cursor', () => {
  it('round-trips a position and hides it from the caller', () => {
    const cursor = encodeCursor(at(5), 'row-1');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ at: at(5), id: 'row-1' });
  });

  it('tells no cursor from a foreign one', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
    expect(decodeCursor('not-ours')).toBeNull();
    expect(decodeCursor(Buffer.from('abc~x').toString('base64url'))).toBeNull();
    expect(() => cursorPosition('not-ours')).toThrow(ApiFailure);
    expect(cursorPosition(undefined)).toBeUndefined();
  });

  it('asks for rows strictly older than the position, the id breaking a tie, with a bound the index can start from', () => {
    expect(after(undefined)).toEqual([]);
    expect(after({ at: at(5), id: 'm' })).toEqual([{ createdAt: { lte: at(5) } }, { OR: [{ createdAt: { lt: at(5) } }, { id: { lt: 'm' } }] }]);
    expect(after({ at: at(5), id: 'm' }, 'at')).toEqual([{ at: { lte: at(5) } }, { OR: [{ at: { lt: at(5) } }, { id: { lt: 'm' } }] }]);
  });

  it('walks every row once, in order, page after page, rows sharing one time included', () => {
    // 23 rows over 5 seconds: most seconds hold several rows, so pages end inside a shared time.
    const rows = Array.from({ length: 23 }, (_, n) => row(`r-${String((n * 7) % 23).padStart(2, '0')}`, Math.floor(n / 5)));
    const newestFirst = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    // What the database answers for `AND: after(position)` under NEWEST_FIRST, evaluated on plain rows.
    const left = (position: ReturnType<typeof cursorPosition>) => {
      const condition = after(position);
      if (condition.length === 0) return newestFirst;
      const [bound, { OR: [older, tie] }] = condition;
      return newestFirst.filter((item) => item.createdAt <= bound.createdAt.lte && (item.createdAt < older.createdAt.lt || item.id < tie.id.lt));
    };
    for (const size of [1, 2, 3, 4, 5, 7, 23]) {
      const served: string[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 30; pages += 1) {
        const listed: ReturnType<typeof page<(typeof rows)[number]>> = page(left(cursorPosition(cursor ?? undefined)).slice(0, size + 1), size);
        served.push(...listed.items.map((item) => item.id));
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      expect([size, served]).toEqual([size, newestFirst.map((item) => item.id)]);
    }
  });
});

describe('page()', () => {
  it('serves `size` rows and a cursor when one more was read', () => {
    const listed = page([row('c', 3), row('b', 2), row('a', 1)], 2);
    expect(listed.items.map((item) => item.id)).toEqual(['c', 'b']);
    expect(decodeCursor(listed.nextCursor ?? undefined)).toEqual({ at: at(2), id: 'b' });
  });

  it('ends the list when no extra row came', () => {
    expect(page([row('b', 2), row('a', 1)], 2)).toEqual({ items: [row('b', 2), row('a', 1)], nextCursor: null });
    expect(page([], 2)).toEqual({ items: [], nextCursor: null });
  });

  it('reads the time from another column when told', () => {
    const listed = page([{ id: 'b', at: at(9) }, { id: 'a', at: at(8) }], 1, (item) => item.at);
    expect(decodeCursor(listed.nextCursor ?? undefined)).toEqual({ at: at(9), id: 'b' });
  });
});

describe('the key cursor', () => {
  it('round-trips a key and refuses a cursor of the other kind', () => {
    expect(keyCursor(encodeKeyCursor('3:pos1'))).toBe('3:pos1');
    expect(keyCursor(undefined)).toBeUndefined();
    expect(() => keyCursor(encodeCursor(at(1), 'x'))).toThrow(ApiFailure);
    expect(() => keyCursor('???')).toThrow(ApiFailure);
  });
});

describe('keyPage()', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((loginName) => ({ loginName }));
  const key = (row: { loginName: string }) => row.loginName;

  it('walks a keyed list page after page and counts every row', () => {
    const first = keyPage(rows, 2, undefined, key);
    expect(first).toMatchObject({ items: [{ loginName: 'a' }, { loginName: 'b' }], total: 5 });
    const second = keyPage(rows, 2, first.nextCursor ?? undefined, key);
    expect(second.items.map(key)).toEqual(['c', 'd']);
    const third = keyPage(rows, 2, second.nextCursor ?? undefined, key);
    expect(third).toMatchObject({ items: [{ loginName: 'e' }], nextCursor: null });
  });

  it('keeps its place when the row the cursor names is gone', () => {
    const first = keyPage(rows, 2, undefined, key);
    const without = rows.filter((row) => row.loginName !== 'b');
    expect(keyPage(without, 2, first.nextCursor ?? undefined, key).items.map(key)).toEqual(['c', 'd']);
  });

  it('ends without a cursor on an exact page and refuses a foreign cursor', () => {
    expect(keyPage(rows.slice(0, 2), 2, undefined, key).nextCursor).toBeNull();
    expect(() => keyPage(rows, 2, 'junk', key)).toThrow(ApiFailure);
  });
});

describe('capList()', () => {
  it('cuts a list read one past the cap and says so', () => {
    expect(capList([1, 2, 3], 2)).toEqual({ rows: [1, 2], capped: true });
    expect(capList([1, 2], 2)).toEqual({ rows: [1, 2], capped: false });
  });
});

describe('a list total counted up to the cap (database plan DB.8)', () => {
  it('answers the count under the cap, and the cap with totalCapped past it', () => {
    expect(TOTAL_CAP).toBe(10_000);
    expect(cappedTotal(0)).toEqual({ total: 0, totalCapped: false });
    expect(cappedTotal(TOTAL_CAP)).toEqual({ total: TOTAL_CAP, totalCapped: false });
    expect(cappedTotal(TOTAL_CAP + 1)).toEqual({ total: TOTAL_CAP, totalCapped: true });
    expect(cappedTotal(4, 3)).toEqual({ total: 3, totalCapped: true });
  });

  it('asks the count for one row past the cap and no more', async () => {
    const asked: number[] = [];
    expect(await countUpTo(async (take) => (asked.push(take), Math.min(take, 7)), 3)).toEqual({ total: 3, totalCapped: true });
    expect(await countUpTo(async (take) => (asked.push(take), Math.min(take, 2)))).toEqual({ total: 2, totalCapped: false });
    expect(asked).toEqual([4, TOTAL_CAP + 1]);
  });
});
