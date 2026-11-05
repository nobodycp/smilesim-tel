import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { BRANDING_STORE } from './branding.store';
import { PrismaBrandingStore } from './prisma-branding.store';

// The BrandingStore contract is Prisma in the app; HTTP tests override BRANDING_STORE with MemoryBrandingStore.
@Module({
  imports: [AuthModule],
  controllers: [BrandingController],
  providers: [BrandingService, { provide: BRANDING_STORE, useClass: PrismaBrandingStore }],
})
export class BrandingModule {}
