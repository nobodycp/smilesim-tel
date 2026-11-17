import { errorRate, statusRange } from './request-log.rules';

describe('request log rules', () => {
  it('reads a status class as its hundred and one status as itself', () => {
    expect(statusRange('2xx')).toEqual({ gte: 200, lte: 299 });
    expect(statusRange('5xx')).toEqual({ gte: 500, lte: 599 });
    expect(statusRange('404')).toEqual({ gte: 404, lte: 404 });
  });

  it('gives the share of server errors with four decimals, and 0 over no requests', () => {
    expect(errorRate(1, 14)).toBe(0.0714);
    expect(errorRate(3, 3)).toBe(1);
    expect(errorRate(0, 0)).toBe(0);
  });
});
