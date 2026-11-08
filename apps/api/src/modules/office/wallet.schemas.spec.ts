import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/auth.store';
import { parseInput } from '../shared/input';
import { OfficeFailure } from '../shared/office-failure';
import type { NoticeService } from './notice.service';
import { OfficeFacade } from './testing/office-facade';
import { CeilingBody, FundBody } from './wallet.schemas';

const invalid = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof OfficeFailure && error.status === 400 && error.code === 'INVALID';
  }
  return false;
};

// The schemas accept and refuse what the hand-written checks did (`positive`, `nonNegative`, the note rule).
describe('wallet schemas', () => {
  it.each([1, 250, 100_000_000])('a fund of %p agorot passes', (amount) => {
    expect(parseInput(FundBody, { amount, note: '  rent ' })).toEqual({ amount, note: 'rent', reason: 'deposit' });
  });

  it.each([0, -5, 1.5, 100_000_001, '100', null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('a fund of %p is INVALID', (amount) => {
    expect(invalid(() => parseInput(FundBody, { amount }))).toBe(true);
  });

  it.each([undefined, 42, { text: 'x' }])('a note that is not text (%p) counts as no note', (note) => {
    expect(parseInput(FundBody, { amount: 10, note })).toEqual({ amount: 10, note: '', reason: 'deposit' });
  });

  it('a body that is not an object is INVALID, and a missing body is an empty one', () => {
    expect(invalid(() => parseInput(FundBody, [10]))).toBe(true);
    expect(invalid(() => parseInput(FundBody, 'amount=10'))).toBe(true);
    expect(invalid(() => parseInput(FundBody, undefined))).toBe(true);
  });

  it.each([0, 1, 100_000_000])('a ceiling of %p passes', (ceiling) => {
    expect(parseInput(CeilingBody, { ceiling })).toEqual({ ceiling });
  });

  it.each([-1, 0.5, 100_000_001, '0', null])('a ceiling of %p is INVALID', (ceiling) => {
    expect(invalid(() => parseInput(CeilingBody, { ceiling }))).toBe(true);
  });

  it('judges the session before the body: no session answers 401 even for a bad body', async () => {
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    const service = new OfficeFacade(new MemoryAuthStore(), notice);
    await expect(service.fund({}, 'pos1', { amount: 'bad' })).rejects.toMatchObject({ status: 401, code: 'LOGIN_REQUIRED' });
    await expect(service.setCeiling({}, 'pos1', { ceiling: -1 })).rejects.toMatchObject({ status: 401, code: 'LOGIN_REQUIRED' });
  });
});
