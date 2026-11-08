import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DoorMiddleware } from './door.middleware';
import { HealthController } from './health.controller';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { featureModules } from './modules/registry';

@Module({
  imports: featureModules,
  controllers: [HealthController],
  providers: [DoorMiddleware, RateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware, DoorMiddleware).forRoutes('*');
  }
}
