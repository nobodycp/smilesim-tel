import ExcelJS from 'exceljs';
import { fail } from '../../shared/office-failure';

// A provider's statement and its comparison with our operations (spec 2026-11-08-provider-reconciliation, roadmap N8).
// Reading turns an .xlsx or .csv file into header + rows of text; matching is pure and works on normalized lines.

export const STATEMENT_ROW_LIMIT = 20_000;
export type StatementMap = { msisdn: number; date: number; amount: number; reference?: number | null };
export type Sheet = { columns: string[]; rows: string[][] };

/** A cell as text: Excel dates as ISO, rich text joined, formulas by their result. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    return '';
  }
  return String(value).trim();
}

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/** The most an uploaded workbook may unpack to, in bytes. */
export const STATEMENT_UNPACKED_LIMIT = 50 * 1024 * 1024;

/**
 * What a zip says its entries unpack to, read from its central directory (each entry's header starts with
 * `PK\x01\x02` and holds the size at offset 24). Nothing is unpacked to find out.
 */
export function unpackedSize(zip: Buffer): number {
  let total = 0;
  for (let at = zip.indexOf('PK\u0001\u0002', 0, 'latin1'); at >= 0 && at + 28 <= zip.length; at = zip.indexOf('PK\u0001\u0002', at + 4, 'latin1')) {
    total += zip.readUInt32LE(at + 24);
  }
  return total;
}

/** The file's first sheet (or the CSV) as a header and rows; empty rows dropped; at most STATEMENT_ROW_LIMIT rows. */
export async function readSheet(fileName: string, content: Buffer): Promise<Sheet> {
  let table: string[][];
  if (/\.csv$/i.test(fileName)) {
    table = parseCsv(content.toString('utf8'));
  } else {
    // An xlsx is a zip: a small file can unpack to gigabytes. Refused before anything is unpacked.
    if (unpackedSize(content) > STATEMENT_UNPACKED_LIMIT) fail(400, 'INVALID');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(content as unknown as ArrayBuffer);
    const sheet = book.worksheets[0];
    table = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[];
      table.push(values.slice(1).map(cellText));
    });
  }
  const filled = table.filter((row) => row.some((cell) => cell !== ''));
  const [head = [], ...rows] = filled;
  return { columns: head.map((name, index) => name || `#${index + 1}`), rows: rows.slice(0, STATEMENT_ROW_LIMIT) };
}

/** A guess at the columns from their names, in Arabic, Hebrew or English. */
export function suggestMap(columns: string[]): Partial<StatementMap> {
  const find = (pattern: RegExp) => {
    const at = columns.findIndex((name) => pattern.test(name));
    return at >= 0 ? at : undefined;
  };
  return {
    msisdn: find(/msisdn|phone|number|mobile|رقم|هاتف|جوال|מספר|טלפון/i),
    date: find(/date|time|تاريخ|وقت|תאריך/i),
    amount: find(/amount|cost|price|total|sum|مبلغ|سعر|تكلفة|المجموع|סכום|מחיר/i),
    reference: find(/ref|id|order|مرجع|طلب|אסמכתא/i) ?? null,
  };
}

/** 0521234567 from +972 52-123-4567, 972521234567 or 521234567. */
export function normalizeMsisdn(text: string): string {
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('5')) digits = `0${digits}`;
  return digits;
}

/** Shekels as written (35, 35.5, -35.00, ₪35, 1,234.50) → agorot, sign dropped. Null when not a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null;
}

/** ISO, an Excel serial day, or day/month/year (with an optional time). Null when unreadable. */
export function parseDate(text: string): Date | null {
  const value = text.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{5}(\.\d+)?$/.test(value)) return new Date(Math.round((Number(value) - 25569) * 86_400_000));
  const dmy = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const date = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 0), Number(dmy[5] ?? 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export type TheirLine = { msisdn: string; at: Date; amount: number; reference: string | null };
export type OurLine = { id: string; msisdn: string; at: Date; amount: number };
export type ReconRow = { kind: 'different' | 'missing_ours' | 'missing_theirs' | 'duplicate'; msisdn: string; at: Date | null; theirAmount: number | null; ourAmount: number | null; ourEntryId: string | null; reference: string | null };

/** The statement's rows, read with the chosen columns; rows without a number, date or amount are skipped. */
export function linesOf(sheet: Sheet, map: StatementMap): { lines: TheirLine[]; skipped: number } {
  const lines: TheirLine[] = [];
  let skipped = 0;
  for (const row of sheet.rows) {
    const msisdn = normalizeMsisdn(row[map.msisdn] ?? '');
    const at = parseDate(row[map.date] ?? '');
    const amount = parseAmount(row[map.amount] ?? '');
    if (!msisdn || !at || amount === null) {
      skipped += 1;
      continue;
    }
    const reference = map.reference != null ? (row[map.reference] ?? '').trim() || null : null;
    lines.push({ msisdn, at, amount, reference });
  }
  return { lines, skipped };
}

const DAY = 86_400_000;
const dayOf = (at: Date) => Math.floor(at.getTime() / DAY);

/**
 * Compares the statement with our operations: same number within a day and the same amount match; the same number
 * within a day with another amount differs; a statement line twice is a duplicate; what is left on either side is missing.
 */
export function reconcile(theirs: TheirLine[], ours: OurLine[]) {
  const rows: ReconRow[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  let matched = 0;
  for (const line of theirs) {
    const key = `${line.msisdn}|${dayOf(line.at)}|${line.amount}|${line.reference ?? ''}`;
    if (seen.has(key)) {
      rows.push({ kind: 'duplicate', msisdn: line.msisdn, at: line.at, theirAmount: line.amount, ourAmount: null, ourEntryId: null, reference: line.reference });
      continue;
    }
    seen.add(key);
    const near = ours.filter((op) => !used.has(op.id) && op.msisdn === line.msisdn && Math.abs(dayOf(op.at) - dayOf(line.at)) <= 1);
    const same = near.find((op) => op.amount === line.amount);
    if (same) {
      used.add(same.id);
      matched += 1;
    } else if (near[0]) {
      used.add(near[0].id);
      rows.push({ kind: 'different', msisdn: line.msisdn, at: line.at, theirAmount: line.amount, ourAmount: near[0].amount, ourEntryId: near[0].id, reference: line.reference });
    } else {
      rows.push({ kind: 'missing_ours', msisdn: line.msisdn, at: line.at, theirAmount: line.amount, ourAmount: null, ourEntryId: null, reference: line.reference });
    }
  }
  for (const op of ours) {
    if (!used.has(op.id)) rows.push({ kind: 'missing_theirs', msisdn: op.msisdn, at: op.at, theirAmount: null, ourAmount: op.amount, ourEntryId: op.id, reference: null });
  }
  const count = (kind: ReconRow['kind']) => rows.filter((row) => row.kind === kind).length;
  return {
    rows,
    counts: { matched, different: count('different'), missing_ours: count('missing_ours'), missing_theirs: count('missing_theirs'), duplicate: count('duplicate') },
    statementTotal: theirs.reduce((sum, line) => sum + line.amount, 0),
    ourTotal: ours.reduce((sum, op) => sum + op.amount, 0),
  };
}
