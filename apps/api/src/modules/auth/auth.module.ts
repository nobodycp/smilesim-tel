import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE, MemoryAuthStore } from './auth.store';

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: AUTH_STORE, useClass: MemoryAuthStore }],
  exports: [AuthService],
})
export class AuthModule {}
