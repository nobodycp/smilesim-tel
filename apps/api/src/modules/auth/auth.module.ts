import { Module } from '@nestjs/common';
import { ActivityModule } from '../office/activity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { PrismaAuthStore } from './prisma-auth.store';

// The AuthStore contract is implemented by Prisma (PostgreSQL) and Redis; HTTP tests override AUTH_STORE with MemoryAuthStore.
// ActivityRecorder comes from ActivityModule (one instance for the process), re-exported for modules that import AuthModule.
@Module({
  imports: [ActivityModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: AUTH_STORE, useClass: PrismaAuthStore }],
  exports: [AuthService, AUTH_STORE, ActivityModule],
})
export class AuthModule {}
