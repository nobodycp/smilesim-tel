import { Global, Module } from '@nestjs/common';
import { ActivityRecorder } from './activity-recorder';

@Global()
@Module({
  providers: [ActivityRecorder],
  exports: [ActivityRecorder],
})
export class ActivityModule {}
