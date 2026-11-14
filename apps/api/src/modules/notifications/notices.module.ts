import { NoticesRepository } from './notices.repository';
import { KernelModule } from '../office/kernel/kernel.module';
import { NoticeInboxService } from './notice-inbox.service';
import { NoticesController } from './notices.controller';
import { Module } from '@nestjs/common';

/** An account's notices: the list, the live stream, marking read. */
export const NOTICES_CONTROLLERS = [NoticesController];
export const NOTICES_PROVIDERS = [NoticesRepository, NoticeInboxService];

@Module({
  imports: [KernelModule],
  controllers: NOTICES_CONTROLLERS,
  providers: NOTICES_PROVIDERS,
  exports: [],
})
export class NoticesModule {}
