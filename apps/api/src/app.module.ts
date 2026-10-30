import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DoorMiddleware } from './door.middleware';
import { HealthController } from './health.controller';
import { featureModules } from './modules/registry';

@Module({
  imports: featureModules,
  controllers: [HealthController],
  providers: [DoorMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DoorMiddleware).forRoutes('*');
  }
}
