import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { enableWebCors } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  enableWebCors(app);
  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
