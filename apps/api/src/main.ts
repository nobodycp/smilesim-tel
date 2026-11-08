import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { enableWebCors } from './cors';
import { setupOpenApi } from './openapi/setup';
import { securityHeaders } from './security-headers';

async function bootstrap() {
  // The default JSON limit is 100 KB; a 768px logo plus its dark copy (PUT /branding) needs more.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  enableWebCors(app);
  setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
