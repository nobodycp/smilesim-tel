import { Prisma, type PrismaClient } from './generated/prisma/client';
import { isSealed, open, seal, secretsKey } from './modules/shared/secret-box';

// Seals the eSIM codes that were stored before sealing on write (ADR 0019, D17; plan slice S.5b). Run by hand
// through `src/seal-secrets.ts`, never at boot.
//
// - It touches only values that are not sealed: a sealed value is never read, opened or rewritten here.
// - It works in small batches by primary key, each batch one transaction. Each row is written with a guard
//   (`WHERE id = … AND "esimQr" = <the value that was read>`), so a row changed in the meantime is left as it is
//   and counted as skipped; the next run sees whatever it holds then.
// - Stopped at any point, it leaves sealed and clear values side by side, which the readers accept (S.5a);
//   running it again does what is left.
// - It ends by counting the clear values left. A dry run only counts.
// - Nothing of a code is returned, thrown or logged: only counts.

const TABLES = ['Line', 'OfficeTask'] as const;
export type CodeTable = (typeof TABLES)[number];
export type TableCount = { clear: number; sealed: number };
export type SealRun = {
  dryRun: boolean;
  /** Per table: sealed by this run, skipped because the row changed between the read and the write, and what is left clear at the end. */
  tables: Record<CodeTable, { sealed: number; skipped: number; clearLeft: number; sealedNow: number }>;
};

export type SealOptions = {
  dryRun?: boolean;
  /** Only the lines and tasks of one point of sale: a first run on one account, and the specs. */
  posId?: string;
  /** Rows per transaction. */
  batchSize?: number;
  /** Called after each batch is committed; a spec stops a run here. */
  afterBatch?: (table: CodeTable, done: number) => Promise<void> | void;
  /** Called between a batch's read and its writes; a spec changes a row here. */
  beforeWrite?: (table: CodeTable, ids: string[]) => Promise<void> | void;
};

const table = (name: CodeTable) => Prisma.raw(`"${name}"`);
const scope = (posId?: string) => (posId ? Prisma.sql`AND "posId" = ${posId}` : Prisma.empty);

/** How many codes of a table are stored clear and how many sealed. */
export async function countCodes(prisma: PrismaClient, name: CodeTable, posId?: string): Promise<TableCount> {
  const rows = await prisma.$queryRaw<{ clear: bigint; sealed: bigint }[]>`
    SELECT count(*) FILTER (WHERE "esimQr" NOT LIKE 'v1:%') AS clear, count(*) FILTER (WHERE "esimQr" LIKE 'v1:%') AS sealed
    FROM ${table(name)} WHERE "esimQr" IS NOT NULL AND "esimQr" <> '' ${scope(posId)}`;
  return { clear: Number(rows[0]?.clear ?? 0), sealed: Number(rows[0]?.sealed ?? 0) };
}

export class NoSealingKey extends Error {
  constructor() {
    super('SECRETS_KEY is not set, or is not 32 bytes of base64');
  }
}

/** Seals one table's clear codes. Answers how many it sealed and how many it left because they had changed. */
async function sealTable(prisma: PrismaClient, name: CodeTable, options: SealOptions): Promise<{ sealed: number; skipped: number }> {
  const size = Math.max(1, options.batchSize ?? 100);
  let after = '';
  let sealed = 0;
  let skipped = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ id: string; esimQr: string }[]>`
      SELECT "id", "esimQr" FROM ${table(name)}
      WHERE "esimQr" IS NOT NULL AND "esimQr" <> '' AND "esimQr" NOT LIKE 'v1:%' AND "id" > ${after} ${scope(options.posId)}
      ORDER BY "id" LIMIT ${size}`;
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    // Sealed and read back before the transaction opens; a value that does not read back is left as it is.
    const ready = rows.flatMap((row) => {
      const value = seal(row.esimQr);
      return isSealed(value) && open(value) === row.esimQr ? [{ id: row.id, clear: row.esimQr, value }] : [];
    });
    skipped += rows.length - ready.length;
    await options.beforeWrite?.(name, rows.map((row) => row.id));
    const written = await prisma.$transaction(async (tx) => {
      let count = 0;
      // Raw, so nothing but the code changes: a task's `updatedAt` is not moved by this.
      for (const row of ready) count += await tx.$executeRaw`UPDATE ${table(name)} SET "esimQr" = ${row.value} WHERE "id" = ${row.id} AND "esimQr" = ${row.clear}`;
      return count;
    });
    sealed += written;
    skipped += ready.length - written;
    await options.afterBatch?.(name, sealed);
  }
  return { sealed, skipped };
}

/**
 * Seals the clear eSIM codes of both tables, or only counts them in a dry run. Refuses to start without a valid
 * key, before reading anything.
 */
export async function sealEsimCodes(prisma: PrismaClient, options: SealOptions = {}): Promise<SealRun> {
  if (!secretsKey()) throw new NoSealingKey();
  const run: SealRun = { dryRun: Boolean(options.dryRun), tables: {} as SealRun['tables'] };
  for (const name of TABLES) {
    const done = options.dryRun ? { sealed: 0, skipped: 0 } : await sealTable(prisma, name, options);
    const now = await countCodes(prisma, name, options.posId);
    run.tables[name] = { ...done, clearLeft: now.clear, sealedNow: now.sealed };
  }
  return run;
}

/** The run in lines for the log: counts only. */
export function sealRunLines(run: SealRun): string[] {
  const lines = TABLES.map((name) => {
    const row = run.tables[name];
    return run.dryRun
      ? `${name}.esimQr: ${row.clearLeft} stored clear, ${row.sealedNow} sealed (dry run: nothing was changed)`
      : `${name}.esimQr: sealed ${row.sealed}, skipped ${row.skipped} (changed while this ran), ${row.clearLeft} left clear, ${row.sealedNow} sealed in all`;
  });
  const left = TABLES.reduce((sum, name) => sum + run.tables[name].clearLeft, 0);
  if (!run.dryRun) lines.push(left === 0 ? 'no eSIM code is stored clear' : `${left} eSIM code(s) are still stored clear: run this again`);
  return lines;
}
