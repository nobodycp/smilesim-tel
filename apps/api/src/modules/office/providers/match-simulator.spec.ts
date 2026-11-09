import { matchOf, matchOverdue, simulatedCharge } from './match-simulator';

// Provider matching, simulated (spec 2026-11-08-overview-and-reports-nav, E).
describe('simulated provider matching', () => {
  const ids = Array.from({ length: 240 }, (_, index) => `op-${index}`);

  it('charges our cost for most operations and a stable 1–5 ₪ difference for about one in twelve', () => {
    const charges = ids.map((id) => simulatedCharge(id, 2500));
    const differences = charges.filter((amount) => amount !== 2500);
    expect(differences.length).toBeGreaterThan(5);
    expect(differences.length).toBeLessThan(60);
    expect(differences.every((amount) => Math.abs(amount - 2500) >= 100 && Math.abs(amount - 2500) <= 500)).toBe(true);
    expect(ids.map((id) => simulatedCharge(id, 2500))).toEqual(charges);
    expect(simulatedCharge('op-0', 0)).toBe(0);
  });

  it('matches an API provider at once, and a statement provider only up to its last statement', () => {
    const op = { id: 'op-1', at: new Date('2026-11-05T10:00:00.000Z'), cost: 2500 };
    expect(matchOf(op, { matchSource: 'api', lastMatchedAt: null }).state).not.toBe('pending');
    expect(matchOf(op, { matchSource: 'statement', lastMatchedAt: null })).toEqual({ state: 'pending', providerAmount: null, difference: null });
    expect(matchOf(op, { matchSource: 'statement', lastMatchedAt: new Date('2026-11-04T00:00:00.000Z') }).state).toBe('pending');
    const covered = matchOf(op, { matchSource: 'statement', lastMatchedAt: new Date('2026-11-06T00:00:00.000Z') });
    expect(covered.providerAmount).toBe(simulatedCharge('op-1', 2500));
    expect(covered.state).toBe(covered.difference === 0 ? 'matched' : 'difference');
  });

  it('marks a statement provider overdue past its period, and never an API provider', () => {
    const now = new Date('2026-11-09T00:00:00.000Z');
    expect(matchOverdue({ matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: null }, now)).toBe(true);
    expect(matchOverdue({ matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: new Date('2026-11-03T00:00:00.000Z') }, now)).toBe(false);
    expect(matchOverdue({ matchSource: 'statement', matchEveryDays: 7, lastMatchedAt: new Date('2026-11-01T00:00:00.000Z') }, now)).toBe(true);
    expect(matchOverdue({ matchSource: 'api', matchEveryDays: 7, lastMatchedAt: null }, now)).toBe(false);
  });
});
