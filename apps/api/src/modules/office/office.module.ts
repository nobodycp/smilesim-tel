import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { NoticeService } from './notice.service';
import { OfficeKernel } from './kernel/office-kernel';
import { NoticeInboxService } from './notices/notice-inbox.service';
import { NoticesController } from './notices/notices.controller';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';

// Exported so HTTP specs build the same set of office routes the app serves, whichever controller holds them.
export const OFFICE_CONTROLLERS = [OfficeController, NoticesController, AuditController];
export const OFFICE_PROVIDERS = [NoticeService, OfficeKernel, OfficeService, NoticeInboxService, AuditService];

@Module({
  imports: [AuthModule],
  controllers: OFFICE_CONTROLLERS,
  providers: OFFICE_PROVIDERS,
})
export class OfficeModule {}
