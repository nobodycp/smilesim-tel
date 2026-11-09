import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DoorMiddleware } from './door.middleware';
import { HealthController } from './health.controller';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { featureModules } from './modules/registry';
import { API_PROVIDERS } from './modules/shared/api-providers';

@Module({
  imports: featureModules,
  controllers: [HealthController],
  providers: [DoorMiddleware, RateLimitMiddleware, ...API_PROVIDERS],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware, DoorMiddleware).forRoutes('*');
  }
}
