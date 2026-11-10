import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { env, productionWarnings } from './config';
import { enableWebCors } from './cors';
import { setupOpenApi } from './openapi/setup';
import { securityHeaders } from './security-headers';

async function bootstrap() {
  // The default JSON limit is 100 KB; a 768px logo plus its dark copy (PUT /branding) needs more.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable('x-powered-by');
  app.use(securityHeaders());
  // JSON only: a form posted by another page has no body the API reads (review 2026-11-10, S8).
  app.useBodyParser('json', { limit: '1mb' });
  // Behind a reverse proxy the caller's address is in X-Forwarded-For; TRUST_PROXY says how many hops to trust.
  const hops = Number(env('TRUST_PROXY'));
  if (Number.isInteger(hops) && hops > 0) app.set('trust proxy', hops);
  enableWebCors(app);
  setupOpenApi(app);
  for (const warning of productionWarnings()) new Logger('Config').warn(warning);
  await app.listen(env('PORT') ?? 3001);
}

bootstrap();
