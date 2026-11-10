import 'reflect-metadata';
import { createPrismaClient } from './db';
import { logger, reason } from './modules/shared/log';

const log = logger('ReservationConflicts');

// Read-only, run by hand before a deploy that carries migration `20261110200000_open_activation_reservations`
// (ADR 0019, D5): lists the open activation tasks that share a SIM serial or a number. The migration stops on the
// same groups; this says so first, without touching anything. Exit code 1 when there is at least one group.
//
//   npm run build --workspace api && npm run reservation-conflicts --workspace api

type Group = { kind: string; value: string; ids: string[]; openedAt: Date[] };

async function run(): Promise<number> {
  const prisma = createPrismaClient();
  try {
    const groups = await prisma.$queryRaw<Group[]>`
      SELECT 'serial' AS kind, "iccid" AS value, array_agg("id" ORDER BY "createdAt", "id") AS ids, array_agg("createdAt" ORDER BY "createdAt", "id") AS "openedAt"
      FROM "OfficeTask" WHERE "action" = 'activate' AND "status" = 'working' AND "iccid" IS NOT NULL
      GROUP BY "iccid" HAVING count(*) > 1
      UNION ALL
      SELECT 'number', "msisdn", array_agg("id" ORDER BY "createdAt", "id"), array_agg("createdAt" ORDER BY "createdAt", "id")
      FROM "OfficeTask" WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL
      GROUP BY "msisdn" HAVING count(*) > 1
      ORDER BY 1, 2`;
    if (groups.length === 0) {
      log.log('no open activation tasks share a SIM serial or a number: the reservation indexes can be created');
      return 0;
    }
    for (const group of groups) {
      const tasks = group.ids.map((id, index) => `${id} (opened ${group.openedAt[index].toISOString()})`).join(', ');
      log.warn(`${group.kind} ${group.value} is named by ${group.ids.length} open activation tasks: ${tasks}`);
    }
    log.warn(`${groups.length} group(s). Reject or cancel all but one task of each group in the office, then run this again. Nothing was changed.`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run().then((code) => process.exit(code), (error) => {
    log.error(reason(error));
    process.exit(2);
  });
}
