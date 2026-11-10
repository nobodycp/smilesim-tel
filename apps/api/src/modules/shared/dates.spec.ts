import { dayRange } from './dates';

// Review 2026-11-10, A11: one reading of a day filter, in UTC, for every list and export.
describe('dayRange', () => {
  it('takes a bare day as the whole day in UTC', () => {
    const { from, to } = dayRange('2026-11-10', '2026-11-10');
    expect(from?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(to?.toISOString()).toBe('2026-11-10T23:59:59.999Z');
  });

  it('takes a full timestamp as written, and something that is not a date as no bound', () => {
    expect(dayRange('2026-11-10T08:30:00.000Z').from?.toISOString()).toBe('2026-11-10T08:30:00.000Z');
    expect(dayRange('yesterday', '')).toEqual({ from: null, to: null });
    expect(dayRange()).toEqual({ from: null, to: null });
  });
});
