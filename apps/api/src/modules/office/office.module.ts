import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';

@Module({
  imports: [AuthModule],
  controllers: [OfficeController],
  providers: [OfficeService],
})
export class OfficeModule {}
