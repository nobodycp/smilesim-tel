import { NoticesRepository } from './notices.repository';
import { AccessModule } from '../access';
import { PlatformModule } from '../platform';
import { AuthModule } from '../auth';
import { NoticeInboxService } from './notice-inbox.service';
import { NoticesController } from './notices.controller';
import { Module } from '@nestjs/common';

/** An account's notices: the list, the live stream, marking read. */
export const NOTICES_CONTROLLERS = [NoticesController];
export const NOTICES_PROVIDERS = [NoticesRepository, NoticeInboxService];

@Module({
  imports: [PlatformModule, AccessModule, AuthModule],
  controllers: NOTICES_CONTROLLERS,
  providers: NOTICES_PROVIDERS,
  exports: [],
})
export class NoticesModule {}
