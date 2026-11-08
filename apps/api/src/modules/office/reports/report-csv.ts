import { cell, shekels } from '../wallets/finance-summary';

/** One report cell: text or a number as is, or `{ money }` in agorot written in shekels. */
export type CsvValue = string | number | { money: number };

/** A report as a UTF-8 CSV with a BOM (Excel reads Arabic then), formula-safe like the ledger's. */
export function csvOf(head: string[], rows: CsvValue[][]): string {
  const lines = [head.join(',')];
  for (const row of rows) lines.push(row.map((value) => cell(typeof value === 'object' ? shekels(value.money) : value)).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
