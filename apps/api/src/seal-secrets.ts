import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AUTH_STORE } from './modules/auth/auth.store';
import { PrismaAuthStore } from './modules/auth/prisma-auth.store';
import { logger } from './modules/shared/log';
import { secretsKey } from './modules/shared/secret-box';

// One-off, run by hand on each environment after SECRETS_KEY is set: seals the authenticator secrets that were
// stored before sealing existed. `npm run seal-secrets --workspace api` (after a build). Safe to run twice.
async function run(): Promise<void> {
  const log = logger('SealSecrets');
  if (!secretsKey()) throw new Error('SECRETS_KEY is not set, or is not 32 bytes of base64');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const store = app.get<PrismaAuthStore>(AUTH_STORE);
    log.log(`sealed ${await store.sealStoredSecrets()} account(s)`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    logger('SealSecrets').error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
