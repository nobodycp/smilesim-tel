import { addEntry, axis, bucketOf, emptyTotals, previousWindow } from './pulse';

describe('home pulse', () => {
  const now = new Date('2026-11-09T15:30:00.000Z');

  it('compares today with yesterday up to the same time, and this month with the same span of the last', () => {
    expect(previousWindow('day', now)).toEqual({ from: new Date('2026-11-08T00:00:00.000Z'), to: new Date('2026-11-08T15:30:00.000Z') });
    expect(previousWindow('month', now)).toEqual({ from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-09T15:30:00.000Z') });
    expect(previousWindow('all', now)).toBeNull();
  });

  it('cuts the month before at its end when this month is longer so far', () => {
    const march = new Date('2026-03-31T10:00:00.000Z');
    expect(previousWindow('month', march)?.to.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('draws the hours of today, the days of this month, and at most 24 months', () => {
    expect(axis('day', now, null)).toHaveLength(16);
    expect(axis('day', now, null)[0]).toBe('2026-11-09T00');
    expect(axis('month', now, null)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    expect(axis('all', now, new Date('2026-11-09T13:10:00.000Z'))).toEqual(['2026-11-09T13', '2026-11-09T14', '2026-11-09T15']);
    expect(axis('all', now, new Date('2026-11-01T10:00:00.000Z'))).toHaveLength(9);
    expect(axis('all', now, new Date('2026-07-15T00:00:00.000Z'))).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(axis('all', now, new Date('2020-01-01T00:00:00.000Z'))).toHaveLength(24);
    expect(bucketOf('hour', now)).toBe('2026-11-09T15');
  });

  it('counts sales and their volume, activations among them, and profit from every entry', () => {
    const totals = emptyTotals();
    addEntry(totals, { kind: 'activate', amount: -4500 }, 700);
    addEntry(totals, { kind: 'charge', amount: -3000 }, 300);
    addEntry(totals, { kind: 'disconnect', amount: 1500 }, -200);
    expect(totals).toEqual({ count: 2, amount: 7500, activations: 1, profit: 800 });
  });
});
