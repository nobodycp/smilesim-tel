import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

