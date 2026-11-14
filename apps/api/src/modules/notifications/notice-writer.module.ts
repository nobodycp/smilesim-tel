import { Global, Module } from '@nestjs/common';
import { NOTICE_WRITER } from '../shared/notices';
import { NoticeService } from './notice.service';

/**
 * The one notice writer of the process (ADR 0020, slice R.2): `NoticeService`, provided as itself (the inbox
 * subscribes through it) and under the platform's `NOTICE_WRITER` port (the unit of work writes and publishes
 * through it). `useExisting`: one instance, so one Redis publisher and one subscriber connection, as before.
 * Global, like the activity recorder, so the unit of work gets it without the kernel importing notifications.
 */
export const NOTICE_WRITER_PROVIDERS = [NoticeService, { provide: NOTICE_WRITER, useExisting: NoticeService }];

@Global()
@Module({
  providers: NOTICE_WRITER_PROVIDERS,
  exports: [NoticeService, NOTICE_WRITER],
})
export class NoticeWriterModule {}
