import ExcelJS from 'exceljs';
import { linesOf, normalizeMsisdn, parseAmount, parseDate, readSheet, reconcile, suggestMap } from './statement';

describe('provider statements', () => {
  it('reads a CSV with quotes, a BOM and semicolons, and an xlsx', async () => {
    const csv = await readSheet('s.csv', Buffer.from('﻿رقم;تاريخ;مبلغ\n"052-100-0001";06/11/2026;"35,00"\n\n0521000002;07/11/2026;40\n'));
    expect(csv.columns).toEqual(['رقم', 'تاريخ', 'مبلغ']);
    expect(csv.rows).toEqual([['052-100-0001', '06/11/2026', '35,00'], ['0521000002', '07/11/2026', '40']]);

    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('a');
    sheet.addRow(['Phone', 'Date', 'Amount']);
    sheet.addRow(['972521000001', new Date('2026-11-06T10:00:00.000Z'), 35]);
    const xlsx = await readSheet('s.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
    expect(xlsx.columns).toEqual(['Phone', 'Date', 'Amount']);
    expect(xlsx.rows[0]).toEqual(['972521000001', '2026-11-06T10:00:00.000Z', '35']);
  });

  it('guesses the columns and normalizes numbers, amounts and dates', () => {
    expect(suggestMap(['التاريخ', 'رقم الهاتف', 'المبلغ', 'مرجع'])).toEqual({ msisdn: 1, date: 0, amount: 2, reference: 3 });
    expect(normalizeMsisdn('+972 52-100-0001')).toBe('0521000001');
    expect(normalizeMsisdn('521000001')).toBe('0521000001');
    expect(parseAmount('-35.00')).toBe(3500);
    expect(parseAmount('₪1,234.50')).toBe(123450);
    expect(parseAmount('35,5')).toBe(3550);
    expect(parseAmount('abc')).toBeNull();
    expect(parseDate('06/11/2026 14:30')?.toISOString()).toBe('2026-11-06T14:30:00.000Z');
    expect(parseDate('2026-11-06')?.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    expect(parseDate('46332')?.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(parseDate('soon')).toBeNull();
  });

  it('matches, finds different amounts, duplicates, and what is missing on either side', () => {
    const sheet = { columns: ['n', 'd', 'a'], rows: [
      ['0521000001', '2026-11-06', '35'],
      ['0521000002', '2026-11-06', '40'],
      ['0521000002', '2026-11-06', '40'],
      ['0521000003', '2026-11-07', '30'],
      ['', '2026-11-07', '30'],
    ] };
    const { lines, skipped } = linesOf(sheet, { msisdn: 0, date: 1, amount: 2 });
    expect(skipped).toBe(1);
    const ours = [
      { id: 'o1', msisdn: '0521000001', at: new Date('2026-11-06T10:00:00Z'), amount: 3500 },
      { id: 'o2', msisdn: '0521000002', at: new Date('2026-11-07T09:00:00Z'), amount: 4500 },
      { id: 'o4', msisdn: '0521000004', at: new Date('2026-11-07T09:00:00Z'), amount: 2000 },
    ];
    const result = reconcile(lines, ours);
    expect(result.counts).toEqual({ matched: 1, different: 1, missing_ours: 1, missing_theirs: 1, duplicate: 1 });
    expect(result.rows.map((row) => [row.kind, row.msisdn, row.theirAmount, row.ourAmount])).toEqual([
      ['different', '0521000002', 4000, 4500],
      ['duplicate', '0521000002', 4000, null],
      ['missing_ours', '0521000003', 3000, null],
      ['missing_theirs', '0521000004', null, 2000],
    ]);
    expect(result.statementTotal).toBe(14500);
    expect(result.ourTotal).toBe(10000);
  });
});
