import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { NoticeService } from './notice.service';
import { OfficeKernel } from './kernel/office-kernel';

@Module({
  imports: [AuthModule],
  controllers: [OfficeController],
  providers: [NoticeService, OfficeKernel, OfficeService],
})
export class OfficeModule {}
