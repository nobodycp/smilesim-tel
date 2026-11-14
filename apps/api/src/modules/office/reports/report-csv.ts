import { csvDocument } from '../../platform/csv';
import { shekels } from '../wallets/finance-summary';

/** One report cell: text or a number as is, or `{ money }` in agorot written in shekels. */
export type CsvValue = string | number | { money: number };

/** A report as a UTF-8 CSV with a BOM (Excel reads Arabic then), formula-safe like the ledger's (`platform/csv.ts`). */
export function csvOf(head: string[], rows: CsvValue[][]): string {
  return csvDocument(head, rows.map((row) => row.map((value) => (typeof value === 'object' ? shekels(value.money) : value))));
}
