import { USERS_PAGE, cursorOf, usersPage } from './users-page';

const row = (loginName: string, layer: string, nickname = loginName) => ({ loginName, layer, nickname });

describe('usersPage', () => {
  const rows = [row('pos2', 'pos'), row('ag1', 'agent', 'وكيل'), row('owner', 'branch'), row('pos1', 'pos', 'نقطة'), row('ma1', 'main_agent')];

  it('orders by layer, then login, and counts every match', () => {
    const { page, nextCursor, total } = usersPage(rows, {});
    expect(page.map((item) => item.loginName)).toEqual(['owner', 'ma1', 'ag1', 'pos1', 'pos2']);
    expect(nextCursor).toBeNull();
    expect(total).toBe(5);
  });

  it('keeps one layer and matches the login or the full name as typed', () => {
    expect(usersPage(rows, { layer: 'pos' }).page.map((item) => item.loginName)).toEqual(['pos1', 'pos2']);
    expect(usersPage(rows, { q: 'نقط' }).page.map((item) => item.loginName)).toEqual(['pos1']);
    expect(usersPage(rows, { q: ' ag ' }).page.map((item) => item.loginName)).toEqual(['ag1']);
    expect(usersPage(rows, { layer: 'nobody' }).total).toBe(5);
  });

  it('reads on from the cursor, page after page, and from the right place when the last row is gone', () => {
    const first = usersPage(rows, {}, 2);
    expect(first.page.map((item) => item.loginName)).toEqual(['owner', 'ma1']);
    expect(first.nextCursor).toBe(cursorOf(row('ma1', 'main_agent')));
    const second = usersPage(rows, { cursor: first.nextCursor! }, 2);
    expect(second.page.map((item) => item.loginName)).toEqual(['ag1', 'pos1']);
    const third = usersPage(rows, { cursor: second.nextCursor! }, 2);
    expect(third.page.map((item) => item.loginName)).toEqual(['pos2']);
    expect(third.nextCursor).toBeNull();
    // ma1 deleted between two reads: the next page still starts after where it stood.
    expect(usersPage(rows.filter((item) => item.loginName !== 'ma1'), { cursor: first.nextCursor! }, 2).page[0].loginName).toBe('ag1');
    expect(usersPage(rows, { cursor: 'junk' }, 2).page[0].loginName).toBe('owner');
  });

  it('pages by fifty', () => {
    const many = Array.from({ length: 120 }, (_, index) => row(`p${String(index).padStart(3, '0')}`, 'pos'));
    const first = usersPage(many, {});
    expect(first.page).toHaveLength(USERS_PAGE);
    expect(first.total).toBe(120);
  });
});
