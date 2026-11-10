import { OfficeFailure } from './office-failure';
import { after, cursorPosition, decodeCursor, encodeCursor, encodeKeyCursor, keyCursor, page } from './paging';

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
    expect(() => cursorPosition('not-ours')).toThrow(OfficeFailure);
    expect(cursorPosition(undefined)).toBeUndefined();
  });

  it('asks for rows strictly older than the position, the id breaking a tie', () => {
    expect(after(undefined)).toEqual([]);
    expect(after({ at: at(5), id: 'm' })).toEqual([{ OR: [{ createdAt: { lt: at(5) } }, { createdAt: at(5), id: { lt: 'm' } }] }]);
    expect(after({ at: at(5), id: 'm' }, 'at')).toEqual([{ OR: [{ at: { lt: at(5) } }, { at: at(5), id: { lt: 'm' } }] }]);
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
    expect(() => keyCursor(encodeCursor(at(1), 'x'))).toThrow(OfficeFailure);
    expect(() => keyCursor('???')).toThrow(OfficeFailure);
  });
});
