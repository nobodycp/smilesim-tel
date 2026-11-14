import { csvCell, csvDocument } from './csv';
import { cell, ledgerCsv, profitCsv, shekels } from '../office/wallets/finance-summary';
import { csvOf } from '../office/reports/report-csv';

// The CSV writer was taken out of the wallets and the reports into the platform (slice R.2 corrections). These
// are the writers as they were before, kept here verbatim as the oracle: every document the API writes must be
// byte for byte what they wrote, BOM, CRLF, quoting, the formula guard and the amounts included.
const before = {
  cell(value: string | number | null | undefined): string {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  },
  shekels: (agorot: number) => (agorot / 100).toFixed(2),
  csvOf(head: string[], rows: (string | number | { money: number })[][]): string {
    const lines = [head.join(',')];
    for (const row of rows) lines.push(row.map((value) => before.cell(typeof value === 'object' ? before.shekels(value.money) : value)).join(','));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  },
  ledgerHead: ['at', 'account', 'layer', 'actor', 'kind', 'amount', 'balance_before', 'balance_after', 'number', 'company', 'package', 'note'],
};

/** Cells that test every rule: Arabic, commas, quotes, line breaks, the four formula starts, numbers that start with a sign. */
const TRICKY: (string | number | null | undefined)[] = [
  'شريحة سلكوم ٣٠٠ جيجا', 'a,b', 'قال "مرحبا"', 'line\nbreak', 'cr\rhere', 'crlf\r\nhere',
  '=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '-12', '-12.50', '+5', '=', '-', '', null, undefined, 0, -1, 12.5,
  "'already", ' =space first', '=1,"2"\n3',
];
const AMOUNTS = [0, 1, -1, 99, 100, -100, 123456, -123456, 100_000_000, 7, -7, 12345678901];

const bytes = (text: string) => Buffer.from(text, 'utf8');

/** Audit rows as `AuditService.csv` builds them, from arbitrary values. */
const auditCsvRows = (values: readonly (string | number | null | undefined)[]): string[][] =>
  values.map((value, index) => {
    const text = value === null || value === undefined ? '' : String(value);
    return ['2026-11-14T10:00:00.000Z', text, 'pos', 'fund', text, 'fail', text, `::ffff:203.0.113.${index}`.replace(/^::ffff:/, '')];
  });

describe('the CSV writer is the one it replaced, byte for byte', () => {
  it('a cell, for every tricky value', () => {
    for (const value of TRICKY) expect({ value, cell: csvCell(value) }).toEqual({ value, cell: before.cell(value) });
    // The name the wallets kept is the same function.
    expect(cell).toBe(csvCell);
  });

  it('amounts are written as before: agorot to shekels with two decimals, unchanged by the move', () => {
    for (const agorot of AMOUNTS) expect(shekels(agorot)).toBe(before.shekels(agorot));
  });

  it('a report (csvOf), with text, numbers and amounts mixed', () => {
    const head = ['company', 'package', 'amount', 'note'];
    const rows = TRICKY.map((value, index) => [String(value ?? ''), typeof value === 'number' ? value : index, { money: AMOUNTS[index % AMOUNTS.length] }, value === null || value === undefined ? '' : String(value)]);
    expect(bytes(csvOf(head, rows))).toEqual(bytes(before.csvOf(head, rows)));
    expect(bytes(csvOf(head, []))).toEqual(bytes(before.csvOf(head, [])));
  });

  it('the ledger, built as before by hand', () => {
    const rows = TRICKY.map((value, index) => ({
      at: '2026-11-14T10:00:00.000Z', loginName: `acc-${index}`, layer: 'pos', actorLoginName: String(value ?? ''), kind: 'fund',
      amount: AMOUNTS[index % AMOUNTS.length], balanceBefore: -AMOUNTS[index % AMOUNTS.length], balanceAfter: 0,
      msisdn: '0591234567', companyName: 'سلكوم', packageName: String(value ?? ''), note: String(value ?? ''),
    }));
    const lines = [before.ledgerHead.join(',')];
    for (const row of rows) {
      lines.push([row.at, row.loginName, row.layer, row.actorLoginName, row.kind, before.shekels(row.amount), before.shekels(row.balanceBefore), before.shekels(row.balanceAfter), row.msisdn, row.companyName, row.packageName, row.note].map(before.cell).join(','));
    }
    expect(bytes(ledgerCsv(rows))).toEqual(bytes(`\uFEFF${lines.join('\r\n')}\r\n`));
  });

  it('the profit report, built as before by hand', () => {
    const rows = TRICKY.map((value, index) => ({ packageName: String(value ?? ''), companyName: 'هوت', sales: index, refunds: -index, profit: AMOUNTS[index % AMOUNTS.length] }));
    const lines = [['company', 'package', 'sales', 'refunds', 'profit'].join(',')];
    for (const row of rows) lines.push([row.companyName, row.packageName, row.sales, row.refunds, before.shekels(row.profit)].map(before.cell).join(','));
    expect(bytes(profitCsv(rows))).toEqual(bytes(`\uFEFF${lines.join('\r\n')}\r\n`));
  });

  it('the audit log, with the head it has always had', () => {
    const head = ['at', 'account', 'layer', 'action', 'subject', 'result', 'reason', 'ip'];
    const rows = auditCsvRows(TRICKY);
    expect(bytes(csvDocument(head, rows))).toEqual(bytes(before.csvOf(head, rows)));
  });

  it('the shape: BOM first, CRLF after every line and the last one, the head as given', () => {
    const text = csvDocument(['a', 'b'], [['x', 'y,z']]);
    expect([...bytes(text).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toBe('\uFEFFa,b\r\nx,"y,z"\r\n');
  });
});
