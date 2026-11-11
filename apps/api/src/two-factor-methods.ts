import 'reflect-metadata';
import { createPrismaClient } from './db';
import { errorCode, logger } from './modules/shared/log';

const log = logger('TwoFactorMethods');

// Read-only, run by hand on a deployment (spec 2026-11-12-two-factor-available-methods): finds the two-step
// verification settings that name SMS or email, which no gateway delivers yet.
//
//   npm run build --workspace api && npm run two-factor-methods --workspace api
//
// Exit code 0: none. 1: at least one. 2: the report could not be made.
//
// It reads four columns of `LayerPolicy` and `User` and changes nothing. What it prints ends up in logs, so an
// account is named by its id only: never a login name, a phone, an email, a secret or a code. A failure is shown
// by a code, never by the database driver's message.

export type MethodFindings = {
  /** Layers whose method is SMS or email, and whether the layer is required. */
  layers: { layer: string; method: string; required: boolean }[];
  /** Accounts that have to enrol and are held to SMS or email, by their own setting or their layer's. Not enrolled. */
  held: { id: string; layer: string; method: string; by: 'account' | 'layer' }[];
  /** Accounts enrolled with SMS or email: they cannot receive their sign-in code. */
  enrolled: { id: string; layer: string; method: string }[];
};

export async function storedFindings(): Promise<MethodFindings> {
  const prisma = createPrismaClient();
  try {
    const layers = await prisma.$queryRaw<MethodFindings['layers']>`
      SELECT "layer", "method", "required" FROM "LayerPolicy" WHERE "method" IN ('sms', 'email') ORDER BY "layer"`;
    const held = await prisma.$queryRaw<MethodFindings['held']>`
      SELECT u."id", u."layer", COALESCE(u."requiredMethod", p."method") AS method,
             CASE WHEN u."requiredMethod" IS NOT NULL THEN 'account' ELSE 'layer' END AS by
      FROM "User" u LEFT JOIN "LayerPolicy" p ON p."layer" = u."layer"
      WHERE u."disabledAt" IS NULL AND u."twoFactorEnabled" = false
        AND (u."twoFactorRequired" = true OR (u."twoFactorExempt" = false AND COALESCE(p."required", false) = true))
        AND COALESCE(u."requiredMethod", p."method") IN ('sms', 'email')
      ORDER BY u."layer", u."id"`;
    const enrolled = await prisma.$queryRaw<MethodFindings['enrolled']>`
      SELECT "id", "layer", "twoFactorMethod" AS method FROM "User"
      WHERE "disabledAt" IS NULL AND "twoFactorEnabled" = true AND "twoFactorMethod" IN ('sms', 'email')
      ORDER BY "layer", "id"`;
    return { layers, held, enrolled };
  } finally {
    await prisma.$disconnect();
  }
}

/** The report's lines. Only layers, methods and account ids. */
export function findingLines(found: MethodFindings): string[] {
  return [
    ...found.layers.map((row) => `layer ${row.layer}: its method is ${row.method} (${row.required ? 'required' : 'optional'}). Its accounts enrol with the authenticator app; set the layer's method to the app in the office to make the stored rule match.`),
    ...found.held.map((row) => `account ${row.id} (${row.layer}): has to enrol and is held to ${row.method} by its ${row.by === 'account' ? 'own setting' : 'layer'}. Not locked out: it is offered the authenticator app at its next sign-in.`),
    ...found.enrolled.map((row) => `account ${row.id} (${row.layer}): enrolled with ${row.method}. It cannot receive its sign-in code. Recovery: after the person is identified, the branch owner resets its two-step verification on the user page; it then enrols with the authenticator app.`),
  ];
}

/** Writes the report and answers the exit code. `read` is the query, so a spec can hand it findings of its own. */
export async function report(read: () => Promise<MethodFindings> = storedFindings): Promise<number> {
  let found: MethodFindings;
  try {
    found = await read();
  } catch (error) {
    log.error(`the report could not be made (${errorCode(error)}); nothing was read or changed`);
    return 2;
  }
  const lines = findingLines(found);
  if (lines.length === 0) {
    log.log('no layer and no account names SMS or email for two-step verification');
    return 0;
  }
  for (const line of lines) log.warn(line);
  log.warn(`${found.layers.length} layer(s), ${found.held.length} account(s) held to a method, ${found.enrolled.length} account(s) enrolled with one. Nothing was changed.`);
  return 1;
}

if (require.main === module) {
  void report().then((code) => process.exit(code));
}
