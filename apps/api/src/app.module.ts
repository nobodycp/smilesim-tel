import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { featureModules } from './modules/registry';

@Module({
  imports: featureModules,
  controllers: [HealthController],
})
export class AppModule {}
