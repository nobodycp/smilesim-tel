import { Module } from '@nestjs/common';
import { ActivityRecorder } from '../office/activity-recorder';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { PrismaAuthStore } from './prisma-auth.store';

// The AuthStore contract is implemented by Prisma (PostgreSQL) and Redis; HTTP tests override AUTH_STORE with MemoryAuthStore.
@Module({
  controllers: [AuthController],
  providers: [AuthService, ActivityRecorder, { provide: AUTH_STORE, useClass: PrismaAuthStore }],
  exports: [AuthService, AUTH_STORE, ActivityRecorder],
})
export class AuthModule {}
