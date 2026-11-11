import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AUTH_STORE } from './modules/auth/auth.store';
import { PrismaAuthStore } from './modules/auth/prisma-auth.store';
import { errorCode, logger } from './modules/shared/log';
import { PrismaService } from './modules/shared/prisma.service';
import { secretsKey } from './modules/shared/secret-box';
import { NoSealingKey, sealEsimCodes, sealRunLines } from './seal-esim-codes';

// Run by hand on each environment after SECRETS_KEY is set, never at boot: seals what was stored before sealing
// existed — the authenticator secrets (review 2026-11-10, S12) and the eSIM codes of lines and tasks (ADR 0019,
// D17; plan slice S.5b, `seal-esim-codes.ts`).
//
//   npm run build --workspace api
//   npm run seal-secrets --workspace api -- --dry-run     counts only, changes nothing
//   npm run seal-secrets --workspace api                  seals; safe to stop and to run again
//
// Exit code 0: done, nothing left clear. 1: eSIM codes are still stored clear (run it again). 2: it could not run.
// It prints counts only: never a code, a secret, a key or the database driver's message.

/** Runs both parts and answers the exit code. `argv` is the command line after the script's name. */
export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const log = logger('SealSecrets');
  const dryRun = argv.includes('--dry-run');
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) {
    log.error('unknown argument: only --dry-run is accepted; nothing was read or changed');
    return 2;
  }
  if (!secretsKey()) {
    log.error(`${new NoSealingKey().message}; nothing was read or changed`);
    return 2;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  // The start-up is kept quiet; from here the counts are the point of the command, so `log` lines show again.
  app.useLogger(['log', 'error', 'warn']);
  try {
    if (dryRun) log.log('authenticator secrets: not counted in a dry run; nothing was changed');
    else log.log(`authenticator secrets: sealed ${await app.get<PrismaAuthStore>(AUTH_STORE).sealStoredSecrets()} account(s)`);
    const done = await sealEsimCodes(app.get(PrismaService).client, { dryRun });
    for (const line of sealRunLines(done)) log.log(line);
    const left = Object.values(done.tables).reduce((sum, row) => sum + row.clearLeft, 0);
    return dryRun || left === 0 ? 0 : 1;
  } catch (error) {
    log.error(`sealing stopped (${errorCode(error)}); what was sealed so far stays sealed, run this again`);
    return 2;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void run().then((code) => process.exit(code));
}
