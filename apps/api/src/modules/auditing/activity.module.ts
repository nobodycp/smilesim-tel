import { Global, Module } from '@nestjs/common';
import { ActivityRecorder } from '../shared/activity';
import { PrismaActivityRecorder } from './activity-recorder';

/**
 * The activity log's writer for the whole process (ADR 0020, slice R.2): the platform's `ActivityRecorder` port,
 * implemented by `PrismaActivityRecorder`. Global and imported once by the app (`registry.ts`), so sign-in, the
 * site identity and every controller's activity interceptor get the one recorder without importing auditing.
 */
@Global()
@Module({
  providers: [{ provide: ActivityRecorder, useClass: PrismaActivityRecorder }],
  exports: [ActivityRecorder],
})
export class ActivityModule {}
