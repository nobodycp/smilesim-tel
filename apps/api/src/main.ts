import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { enableWebCors } from './cors';
import { setupOpenApi } from './openapi/setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  enableWebCors(app);
  setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
