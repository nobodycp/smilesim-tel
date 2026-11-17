import { searchTerms } from '../platform/search';
import { financeSearch, loginIdsContaining } from './finance-search';

describe('the finance search (spec 2026-11-17-scale-speed-cleanup, "Search (DB.6)")', () => {
  const none = { loginIds: [], packageNamed: false, companyNamed: false };

  it('matches a number query against the number and the logins holding it, and not the note', () => {
    expect(financeSearch(searchTerms('٠٥٤-١٠٠'), { ...none, loginIds: ['u1'] })).toEqual({ OR: [{ msisdn: { contains: '054100' } }, { userId: { in: ['u1'] } }] });
    expect(financeSearch(searchTerms('0541'), none)).toEqual({ OR: [{ msisdn: { contains: '0541' } }] });
  });

  it('reads the stored package or company name for a number query only when the catalog has such a name', () => {
    expect(financeSearch(searchTerms('100'), { ...none, packageNamed: true })).toEqual({
      OR: [{ msisdn: { contains: '100' } }, { packageName: { contains: '100', mode: 'insensitive' } }],
    });
    expect(financeSearch(searchTerms('100'), { ...none, companyNamed: true })).toEqual({
      OR: [{ msisdn: { contains: '100' } }, { companyName: { contains: '100', mode: 'insensitive' } }],
    });
  });

  it('matches any other query against the number as typed, the note, the stored names and the logins, as before', () => {
    expect(financeSearch(searchTerms(' سلكوم '), { loginIds: ['u2'], packageNamed: true, companyNamed: true })).toEqual({
      OR: [
        { msisdn: { contains: 'سلكوم' } },
        { note: { contains: 'سلكوم', mode: 'insensitive' } },
        { packageName: { contains: 'سلكوم', mode: 'insensitive' } },
        { companyName: { contains: 'سلكوم', mode: 'insensitive' } },
        { userId: { in: ['u2'] } },
      ],
    });
  });

  it('adds nothing when nothing was typed', () => {
    expect(financeSearch(searchTerms('  '), none)).toEqual({});
  });

  it('finds the logins that contain the text, case aside', () => {
    const accounts = [{ id: 'a', loginName: 'Pos_44' }, { id: 'b', loginName: 'agent' }];
    expect(loginIdsContaining(accounts, ['pos'])).toEqual(['a']);
    expect(loginIdsContaining(accounts, ['GEN', '44'])).toEqual(['a', 'b']);
    expect(loginIdsContaining(accounts, ['x'])).toEqual([]);
  });
});
