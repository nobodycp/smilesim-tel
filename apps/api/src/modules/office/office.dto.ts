import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnnouncementBodyDto {
  @ApiPropertyOptional()
  body?: string;
}

export class FundBodyDto {
  @ApiPropertyOptional({ example: 100 })
  amount?: number;

  @ApiPropertyOptional({ description: 'Required note when funding' })
  note?: string;
}

export class CeilingBodyDto {
  @ApiPropertyOptional()
  ceiling?: number;
}

export class PackageTargetsBodyDto {
  @ApiPropertyOptional({ description: 'Target login names or rules blob', type: 'array', items: { type: 'string' } })
  targets?: unknown;
}

export class RepriceRenewalBodyDto {
  @ApiPropertyOptional()
  which?: string;

  @ApiPropertyOptional()
  posPrice?: number;
}

export class OfferBodyDto {
  @ApiPropertyOptional()
  loginName?: string;

  @ApiPropertyOptional()
  price?: number;
}

export class PackagePriceBodyDto {
  @ApiPropertyOptional()
  price?: number;
}

export class ProviderModeBodyDto {
  @ApiPropertyOptional({ description: 'Catalog action key', example: 'activate' })
  action?: string;

  @ApiPropertyOptional({ description: 'auto | manual | off', example: 'manual' })
  mode?: string;
}

export class CompanyImageBodyDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Data URL or stored image payload' })
  image?: string;
}

export class OutcomeBodyDto {
  @ApiPropertyOptional({ description: 'Provider operation outcome token' })
  outcome?: string;
}

export class ExtendBodyDto {
  @ApiPropertyOptional()
  outcome?: string;

  @ApiPropertyOptional()
  targetCode?: string;
}

export class RenameLineBodyDto {
  @ApiPropertyOptional()
  msisdn?: string;

  @ApiPropertyOptional()
  outcome?: string;
}

export class SwapSimBodyDto {
  @ApiPropertyOptional()
  iccid?: string;

  @ApiPropertyOptional()
  outcome?: string;
}

export class TransferLineBodyDto {
  @ApiPropertyOptional()
  posLogin?: string;
}

export class SwitchPackageBodyDto {
  @ApiPropertyOptional()
  packageCode?: string;

  @ApiPropertyOptional()
  outcome?: string;
}

export class NoticeReadBodyDto {
  @ApiPropertyOptional({ description: 'Omit to mark all readable notices' })
  id?: string;
}

export class TaskNoteBodyDto {
  @ApiPropertyOptional()
  note?: string;
}

export class TaskInspectionNoteBodyDto {
  @ApiPropertyOptional({ description: 'Inspection note body; does not close the task' })
  text?: string;
}

export class TaskRejectBodyDto {
  @ApiPropertyOptional()
  reason?: string;
}

export class AccessBodyDto {
  @ApiPropertyOptional({ type: [String] })
  extraGrants?: string[];

  @ApiPropertyOptional({ type: [String] })
  deniedGrants?: string[];

  @ApiPropertyOptional({ type: [String] })
  extraRoleIds?: string[];

  @ApiPropertyOptional()
  roleId?: string;
}

export class CreateUserBodyDto {
  @ApiPropertyOptional()
  loginName?: string;

  @ApiPropertyOptional()
  nickname?: string;

  @ApiPropertyOptional()
  password?: string;

  @ApiPropertyOptional()
  layer?: string;

  @ApiPropertyOptional()
  parentLogin?: string;

  @ApiPropertyOptional()
  roleId?: string;
}

export class TransferPosBodyDto {
  @ApiPropertyOptional()
  parentLogin?: string;
}

export class SetAccountPasswordBodyDto {
  @ApiPropertyOptional()
  password?: string;
}
