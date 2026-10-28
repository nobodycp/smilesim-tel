import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { featureModules } from './modules/registry';

@Module({
  imports: featureModules as any[],
  controllers: [HealthController],
})
export class AppModule {}
