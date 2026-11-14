// The one CSV writer of the API (slice R.2 corrections): the ledger, the profit report, the reports, a provider's
// account and the audit log all go through it. Pure, and it knows nothing of money: an amount arrives already
// written as text (`wallets/finance-summary.ts` `shekels`), so no module reaches the wallets through the platform.
//
// A document is UTF-8 with a BOM (Excel then reads Arabic), lines end in CRLF and the last line too. The head is
// written as given; every cell of a row goes through `csvCell`.

/** One cell: quoted when it holds a quote, a comma or a line break; a leading = + - @ is prefixed with `'` so a
 * spreadsheet never runs it as a formula, unless the cell is a plain number (a negative amount stays a number). */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A whole document: the BOM, the head, one line per row, CRLF after every line. */
export function csvDocument(head: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [head.join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
