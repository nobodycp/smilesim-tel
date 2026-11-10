import 'reflect-metadata';
import { createPrismaClient } from './db';
import { conflictLines, type ReservationConflict } from './modules/office/lines/reservation.rules';
import { errorCode, logger } from './modules/shared/log';

const log = logger('ReservationConflicts');

// Read-only, run by hand before a deploy that carries migration `20261110200000_open_activation_reservations`
// (ADR 0019, D5): lists the open activation tasks that share a SIM serial or a number. The migration stops on the
// same groups; this says so first, without touching anything.
//
//   npm run build --workspace api && npm run reservation-conflicts --workspace api
//
// Exit code 0: none. 1: at least one group. 2: the report could not be made.
//
// What it prints ends up in deploy logs, so a serial or a number is shown by its last four characters only, and a
// failure by a code, never by the database driver's message (which can quote the connection it failed on). The
// task ids are whole: they are what the branch resolves the conflict by.

/** The groups as the database holds them: `kind`, the shared value, and the tasks' ids, oldest first. */
export async function openConflicts(): Promise<ReservationConflict[]> {
  const prisma = createPrismaClient();
  try {
    return await prisma.$queryRaw<ReservationConflict[]>`
      SELECT 'serial' AS kind, "iccid" AS value, array_agg("id" ORDER BY "createdAt", "id") AS "taskIds"
      FROM "OfficeTask" WHERE "action" = 'activate' AND "status" = 'working' AND "iccid" IS NOT NULL
      GROUP BY "iccid" HAVING count(*) > 1
      UNION ALL
      SELECT 'number', "msisdn", array_agg("id" ORDER BY "createdAt", "id")
      FROM "OfficeTask" WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL
      GROUP BY "msisdn" HAVING count(*) > 1
      ORDER BY 1, 3`;
  } finally {
    await prisma.$disconnect();
  }
}

/** Writes the report and answers the exit code. `read` is the query, so a spec can hand it groups of its own. */
export async function report(read: () => Promise<ReservationConflict[]> = openConflicts): Promise<number> {
  let conflicts: ReservationConflict[];
  try {
    conflicts = await read();
  } catch (error) {
    log.error(`the report could not be made (${errorCode(error)}); nothing was read or changed`);
    return 2;
  }
  if (conflicts.length === 0) {
    log.log('no open activation tasks share a SIM serial or a number: the reservation indexes can be created');
    return 0;
  }
  for (const line of conflictLines(conflicts)) log.warn(line);
  log.warn(`${conflicts.length} group(s). Reject or cancel all but one task of each group in the office, then run this again. Nothing was changed.`);
  return 1;
}

if (require.main === module) {
  void report().then((code) => process.exit(code));
}
