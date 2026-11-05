import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { NoticeService } from './notice.service';

@Module({
  imports: [AuthModule],
  controllers: [OfficeController],
  providers: [NoticeService, OfficeService],
})
export class OfficeModule {}
