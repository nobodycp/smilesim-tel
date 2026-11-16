import { csvDocument } from '../platform';
import { shekels } from './finance-summary';

// A report's CSV with its money in shekels: the wallets' (who write money as text, `shekels`) since slice R.7, so
// that the provider accounts and the reports use it without one importing the other.

/** One report cell: text or a number as is, or `{ money }` in agorot written in shekels. */
export type CsvValue = string | number | { money: number };

/** A report as a UTF-8 CSV with a BOM (Excel reads Arabic then), formula-safe like the ledger's (`platform/csv.ts`). */
export function csvOf(head: string[], rows: CsvValue[][]): string {
  return csvDocument(head, rows.map((row) => row.map((value) => (typeof value === 'object' ? shekels(value.money) : value))));
}
