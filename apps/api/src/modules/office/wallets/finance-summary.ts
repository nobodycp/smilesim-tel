// The finance page's head for one wallet: the money that came in and went out over the last days, and the balance
// at the end of each day. Pure: the service reads the entries.

export const SUMMARY_DAYS = 30;
/** The windows the finance page offers (owner 2026-11-09: 7 days, 30 days, 3 months). */
export const SUMMARY_WINDOWS = [7, 30, 90] as const;
/** Movements a person made by hand: funding and taking money back. */
const MANUAL_KINDS = new Set(['fund', 'self_fund', 'deduct', 'deduct_in']);

export function summaryDays(value: string | undefined): number {
  const days = Number(value);
  return (SUMMARY_WINDOWS as readonly number[]).includes(days) ? days : SUMMARY_DAYS;
}

type Entry = { createdAt: Date; amount: number; balanceAfter: number; kind?: string };

const dayKey = (at: Date) => at.toISOString().slice(0, 10);

/**
 * `entries` are this wallet's entries since the window opened, oldest first; `balance` is the wallet now. A day with no
 * entry keeps the balance it ended the day before with. Days are UTC calendar days.
 */
export function walletSummary(entries: Entry[], balance: number, now: Date, days = SUMMARY_DAYS) {
  const moneyIn = entries.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const moneyOut = entries.filter((row) => row.amount < 0).reduce((sum, row) => sum - row.amount, 0);
  const first = entries[0];
  let running = first ? first.balanceAfter - first.amount : balance;
  const endOfDay = new Map<string, number>();
  for (const row of entries) endOfDay.set(dayKey(row.createdAt), row.balanceAfter);
  const series: { day: string; balance: number }[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = dayKey(new Date(now.getTime() - back * 86_400_000));
    running = endOfDay.get(day) ?? running;
    series.push({ day, balance: running });
  }
  const manual = entries.filter((row) => row.kind && MANUAL_KINDS.has(row.kind)).length;
  return { moneyIn, moneyOut, count: entries.length, manual, days, series };
}

/** Opens the window: the first instant of the oldest day the summary shows. */
export function windowStart(now: Date, days = SUMMARY_DAYS): Date {
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  return new Date(`${dayKey(start)}T00:00:00.000Z`);
}

const CSV_HEAD = ['at', 'account', 'layer', 'actor', 'kind', 'amount', 'balance_before', 'balance_after', 'number', 'company', 'package', 'note'];

export function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote every cell that needs it; a leading = + - @ is prefixed so a spreadsheet never runs it as a formula.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const shekels = (agorot: number) => (agorot / 100).toFixed(2);

/** The ledger rows as a UTF-8 CSV with a BOM (Excel reads Arabic then). Amounts in shekels. */
export function ledgerCsv(rows: {
  at: string; loginName: string; layer: string; actorLoginName: string; kind: string; amount: number; balanceBefore: number;
  balanceAfter: number; msisdn: string; companyName: string; packageName: string; note: string;
}[]): string {
  const lines = [CSV_HEAD.join(',')];
  for (const row of rows) {
    lines.push([
      row.at, row.loginName, row.layer, row.actorLoginName, row.kind, shekels(row.amount), shekels(row.balanceBefore),
      shekels(row.balanceAfter), row.msisdn, row.companyName, row.packageName, row.note,
    ].map(cell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** The profit report as a CSV with a BOM: one line per package, amounts in shekels. */
export function profitCsv(rows: { packageName: string; companyName: string; sales: number; refunds: number; profit: number }[]): string {
  const lines = [['company', 'package', 'sales', 'refunds', 'profit'].join(',')];
  for (const row of rows) lines.push([row.companyName, row.packageName, row.sales, row.refunds, shekels(row.profit)].map(cell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
