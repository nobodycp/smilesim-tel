# Reconciliation with providers (roadmap N8)

Date: 2026-11-08 · Status: done · Owner: «المطابقة عبر التقارير: من الـ API لاحقاً أو رفع كشوفات Excel، وكل مزود يختلف»

## Flow

1. On a provider's account page, tab «المطابقة»: upload the provider's statement (`.xlsx` or `.csv`).
2. The page shows the file's columns and a few rows; the accountant points at the number, date and amount columns
   (and an optional reference). The choice is kept per provider (`Provider.statementMap`), since each provider's file
   differs, and is offered again next time.
3. «طابق» compares the statement with our operations at that provider over the statement's dates (± one day):
   - **مطابق**: same number, same day (± 1), same amount.
   - **مختلف**: same number and day, another amount.
   - **ناقص عندنا**: in the statement, not in our operations.
   - **ناقص عندهم**: in our operations, not in the statement.
   - **مكرر**: the same line twice in the statement.
   Totals: the statement's sum against ours, and the difference.
4. The run is saved (`ProviderReconciliation`, its non-matching rows as `ProviderReconItem`). Each difference stays
   **مفتوح** until the accountant marks it **تمت المعالجة** with a note; earlier runs stay listed.

Numbers are compared as digits (a leading 972 becomes 0); amounts in shekels become agorot, sign ignored; dates read
as Excel dates, ISO, or day/month/year. At most 20,000 statement rows; files up to the API's 1 MB body (sent as base64).

## API

`POST /office/provider-accounts/:code/statements/preview` `{ fileName, content }` → columns, sample, suggested map;
`POST …/:code/reconciliations` `{ fileName, content, map }` → the saved run; `GET …/:code/reconciliations` → runs;
`GET /office/reconciliations/:id` → a run with its rows; `PATCH /office/reconciliation-items/:id` `{ status, note }`.
Read like provider accounts (owner, accounting or reports); write the owner or accounting. Library: `exceljs` (MIT).

## Checked

`providers/statement.spec.ts` (CSV with quotes, BOM and semicolons; xlsx through exceljs; column guesses; numbers,
amounts and dates; matched, different, duplicate, missing on either side, totals), route table and matrix,
`tests/reconciliation.spec.ts` (upload, columns, compare, handle a difference). On Docker: a statement built from three
real sky operations (one amount raised by 5 ₪) and a made-up line → 2 matched, 1 different (45 vs 40 ₪), 1 missing on
our side; the column choice was kept for sky.
