import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginBodyDto {
  @ApiProperty({ example: 'branch' })
  loginName?: string;

  @ApiProperty({ example: '123456' })
  password?: string;
}

export class ChangePasswordBodyDto {
  @ApiPropertyOptional()
  password?: string;

  @ApiPropertyOptional()
  nextPassword?: string;
}

export class UpdateProfileBodyDto {
  @ApiPropertyOptional({ description: 'Full name (the field keeps its historical name)' })
  nickname?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'A key from the Palestinian city list; empty clears it' })
  city?: string;

  @ApiPropertyOptional({ description: 'Free text, at most 120 characters; empty clears it' })
  address?: string;

  @ApiPropertyOptional()
  nextPassword?: string;

  @ApiPropertyOptional()
  currentPassword?: string;
}

export class SetPasswordBodyDto {
  @ApiPropertyOptional()
  password?: string;
}

export class TwoFactorCodeBodyDto {
  @ApiPropertyOptional({ example: '123456' })
  code?: string;
}

export class PolicyBodyDto {
  @ApiPropertyOptional({ description: 'Layer key, e.g. branch | main_agent | agent | pos' })
  layer?: string;

  @ApiPropertyOptional({ description: 'Whether 2FA is required for that layer' })
  required?: boolean;
}

export class ExemptionBodyDto {
  @ApiPropertyOptional()
  exempt?: boolean;
}

export class OkDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

export class NextAppDto {
  @ApiProperty({ example: 'app' })
  next!: string;
}

export class OtpauthDto {
  @ApiProperty({ description: 'otpauth:// URI for authenticator apps' })
  otpauth!: string;
}

export class ProfileDto {
  @ApiProperty()
  loginName!: string;

  @ApiPropertyOptional({ description: 'Full name (the field keeps its historical name)' })
  nickname?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'A key from the Palestinian city list' })
  city?: string;

  @ApiPropertyOptional()
  address?: string;
}

export class SessionRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userAgent!: string;

  @ApiProperty()
  ip!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  lastSeenAt!: string;

  @ApiProperty()
  current!: boolean;
}

export class SessionsListDto {
  @ApiProperty({ type: [SessionRowDto] })
  sessions!: SessionRowDto[];
}

export class TwoFactorExemptDto {
  @ApiProperty()
  twoFactorExempt!: boolean;
}

export class TwoFactorMethodBodyDto {
  @ApiPropertyOptional({ enum: ['sms', 'email'] })
  method?: string;

  @ApiPropertyOptional({ example: '123456', description: 'Only when confirming' })
  code?: string;
}

export class PasskeyBodyDto {
  @ApiPropertyOptional({ description: 'The browser answer (RegistrationResponseJSON)' })
  response?: unknown;

  @ApiPropertyOptional({ example: 'iPhone' })
  name?: string;
}

export class PasskeyLoginBodyDto {
  @ApiPropertyOptional()
  loginId?: string;

  @ApiPropertyOptional({ description: 'The browser answer (AuthenticationResponseJSON)' })
  response?: unknown;
}
