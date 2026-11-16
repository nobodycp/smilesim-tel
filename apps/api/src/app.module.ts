import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DoorMiddleware } from './door.middleware';
import { HealthController } from './health.controller';
import { OriginMiddleware } from './origin.middleware';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { RequestLogMiddleware } from './request-log.middleware';
import { featureModules } from './modules/registry';
import { API_PROVIDERS } from './modules/platform/api-providers';

@Module({
  imports: featureModules,
  controllers: [HealthController],
  providers: [RequestLogMiddleware, OriginMiddleware, DoorMiddleware, RateLimitMiddleware, ...API_PROVIDERS],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // The request log first (spec 2026-11-17-system-monitor): what the others refuse is written too.
    consumer.apply(RequestLogMiddleware, OriginMiddleware, RateLimitMiddleware, DoorMiddleware).forRoutes('*');
  }
}
