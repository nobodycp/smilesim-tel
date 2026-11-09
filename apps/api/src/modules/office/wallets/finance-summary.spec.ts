import { ledgerCsv, summaryDays, walletSummary, windowStart } from './finance-summary';

const at = (iso: string) => new Date(iso);

describe('walletSummary', () => {
  const now = at('2026-11-08T12:00:00.000Z');

  it('sums money in and out and keeps each day at the balance it ended with', () => {
    const entries = [
      { createdAt: at('2026-11-06T09:00:00.000Z'), amount: 30000, balanceAfter: 30000, kind: 'fund' },
      { createdAt: at('2026-11-06T10:00:00.000Z'), amount: -1898, balanceAfter: 28102, kind: 'activate' },
      { createdAt: at('2026-11-08T08:00:00.000Z'), amount: -3296, balanceAfter: 24806 },
    ];
    const summary = walletSummary(entries, 24806, now, 5);
    expect(summary).toMatchObject({ moneyIn: 30000, moneyOut: 5194, count: 3, manual: 1, days: 5 });
    expect(summary.series).toEqual([
      { day: '2026-11-04', balance: 0 },
      { day: '2026-11-05', balance: 0 },
      { day: '2026-11-06', balance: 28102 },
      { day: '2026-11-07', balance: 28102 },
      { day: '2026-11-08', balance: 24806 },
    ]);
  });

  it('draws a flat line at the balance when nothing moved', () => {
    const summary = walletSummary([], 5000, now, 3);
    expect(summary.series.map((point) => point.balance)).toEqual([5000, 5000, 5000]);
    expect(summary).toMatchObject({ moneyIn: 0, moneyOut: 0, count: 0 });
  });

  it('takes 7, 30 or 90 days and falls back to 30', () => {
    expect([summaryDays('7'), summaryDays('90'), summaryDays('45'), summaryDays(undefined)]).toEqual([7, 90, 30, 30]);
  });

  it('opens the window at the start of the oldest day', () => {
    expect(windowStart(now, 30).toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });
});

describe('ledgerCsv', () => {
  it('writes a BOM, shekel amounts, quotes where needed, and defuses formulas', () => {
    const csv = ledgerCsv([{
      at: '2026-11-06T09:00:00.000Z', loginName: 'pos1', layer: 'pos', actorLogin: 'admin', kind: 'activate',
      amount: -1898, balanceBefore: 30000, balanceAfter: 28102, msisdn: '0550000001', companyName: 'سلكوم, بارتنر',
      packageName: '150 جيجا', note: '=HYPERLINK("x")',
    }]);
    expect(csv.startsWith('\uFEFFat,account,layer,')).toBe(true);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('2026-11-06T09:00:00.000Z,pos1,pos,admin,activate,-18.98,300.00,281.02,0550000001,"سلكوم, بارتنر",150 جيجا,"\'=HYPERLINK(""x"")"');
  });
});
