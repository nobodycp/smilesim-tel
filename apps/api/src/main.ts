import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { cacheControl } from './cache-control';
import { env, wholeEnv } from './config';
import { enableWebCors } from './cors';
import { setupOpenApi } from './openapi/setup';
import { ProductionConfigError, assertProductionConfig, trustedProxyHops } from './production-config';
import { securityHeaders } from './security-headers';

async function bootstrap() {
  // Before anything is opened: a production process with unsafe settings does not start (ADR 0016).
  assertProductionConfig(wholeEnv());
  // The default JSON limit is 100 KB; a 768px logo plus its dark copy (PUT /branding) needs more.
  // `forceCloseConnections`: on a stop the open connections are closed with the server. Without it a notice stream
  // (one endless request a tab) keeps the server from closing, and the process, its modules already destroyed, stays
  // until it is killed: the API was down for as long as a tab was open (seen on the running copy, 2026-11-17).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, forceCloseConnections: true });
  app.disable('x-powered-by');
  app.use(securityHeaders());
  // Before the body parser and every other middleware: its errors and their refusals carry the default too (PF.11).
  app.use(cacheControl());
  // JSON only: a form posted by another page has no body the API reads (review 2026-11-10, S8).
  app.useBodyParser('json', { limit: '1mb' });
  // Behind a reverse proxy the caller's address is in X-Forwarded-For; TRUST_PROXY says how many hops to trust.
  // Unset or 0, the header is not read at all and the caller is whoever opened the connection.
  const hops = trustedProxyHops(env('TRUST_PROXY'));
  if (hops !== null && hops > 0) app.set('trust proxy', hops);
  enableWebCors(app);
  // On SIGTERM the modules are closed in order, so the request log writes the rows still waiting in memory.
  app.enableShutdownHooks();
  setupOpenApi(app);
  await app.listen(env('PORT') ?? 3001);
}

bootstrap().catch((error: unknown) => {
  // The problems name variables and rules, never values.
  if (error instanceof ProductionConfigError) new Logger('Config').error(error.message);
  else new Logger('Bootstrap').error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
