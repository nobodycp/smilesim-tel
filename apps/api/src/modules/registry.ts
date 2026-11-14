// apps/api/src/modules/registry.ts
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { ActivityModule } from './auditing/activity.module';
import { NoticeWriterModule } from './notifications/notice-writer.module';
import { OfficeModule } from './office/office.module';
import { PrismaModule } from './shared/prisma.service';

// The two global writers first: the activity log and the notice writer, each the one implementation of a port of
// the platform (ADR 0020, slice R.2).
// The extension contract requires `any[]` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const featureModules: any[] = [PrismaModule, ActivityModule, NoticeWriterModule, AuthModule, OfficeModule, BrandingModule];
