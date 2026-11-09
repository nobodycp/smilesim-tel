import { ApiPropertyOptional } from '@nestjs/swagger';

export class FundBodyDto {
  @ApiPropertyOptional({ example: 100 })
  amount?: number;

  @ApiPropertyOptional({ description: 'Required note when funding' })
  note?: string;

  @ApiPropertyOptional({ enum: ['deposit', 'correction', 'settlement'], default: 'deposit' })
  reason?: string;
}

export class DeductBodyDto {
  @ApiPropertyOptional({ example: 100 })
  amount?: number;

  @ApiPropertyOptional({ description: 'Required: why the money is taken back' })
  note?: string;

  @ApiPropertyOptional({ enum: ['return', 'correction', 'settlement'] })
  reason?: string;
}

export class CeilingBodyDto {
  @ApiPropertyOptional()
  ceiling?: number;
}

export class PackageTargetsBodyDto {
  @ApiPropertyOptional({ description: 'Target login names or rules blob', type: 'array', items: { type: 'string' } })
  targets?: unknown;
}

export class UserPackageBodyDto {
  @ApiPropertyOptional({ description: 'Hide the package from this account and everyone below it' })
  hidden?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Special subscription price; null clears it' })
  price?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Special renewal price; null clears it' })
  renewalPrice?: number | null;
}

export class UserPackagesBulkBodyDto {
  @ApiPropertyOptional({ type: [String] })
  codes?: string[];

  @ApiPropertyOptional()
  hidden?: boolean;
}

export class UserOpsBodyDto {
  @ApiPropertyOptional({ type: [String], description: 'Line operations stopped on this account' })
  denied?: string[];
}

export class CustomPriceBodyDto {
  @ApiPropertyOptional({ nullable: true })
  price?: number | null;

  @ApiPropertyOptional({ nullable: true })
  renewalPrice?: number | null;
}

export class LinePricesBodyDto {
  @ApiPropertyOptional({ description: 'An account login (that account and everything under it) or "all" (branch only)' })
  scope?: string;

  @ApiPropertyOptional({
    description: 'One entry per price group: `from` is the renewal price the numbers carry now, `to` the flat price they take or "current" for what a new activation would carry',
    type: 'array',
    items: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'integer', example: 4500 },
        to: { oneOf: [{ type: 'integer', example: 4100 }, { type: 'string', enum: ['current'] }] },
      },
    },
  })
  groups?: { from: number; to: number | 'current' }[];
}

export class SellPriceBodyDto {
  @ApiPropertyOptional()
  price?: number;

  @ApiPropertyOptional({ nullable: true })
  renewalPrice?: number | null;
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

export class CompanySimBodyDto {
  @ApiPropertyOptional({ description: 'Exact ICCID length (10-22), or null for no check', nullable: true, type: Number })
  length?: number | null;

  @ApiPropertyOptional({ description: 'ICCID prefix, digits only, or empty for no check' })
  prefix?: string;

  @ApiPropertyOptional({ description: 'Whether the company takes eSIM' })
  esim?: boolean;

  @ApiPropertyOptional({ description: 'Default eSIM price for the company, agorot' })
  esimPrice?: number;
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
  @ApiPropertyOptional({ description: 'Serial of the SIM the branch already holds' })
  iccid?: string;

  @ApiPropertyOptional({ description: 'The serial is an eSIM the branch already holds' })
  esim?: boolean;

  @ApiPropertyOptional({ description: 'QR picture of that eSIM as a data URL (png, jpeg, webp)', nullable: true })
  qr?: string | null;

  @ApiPropertyOptional()
  outcome?: string;
}

export class TransferLineBodyDto {
  @ApiPropertyOptional({ description: 'The point of sale the number moves to' })
  posLogin?: string;

  @ApiPropertyOptional({ enum: ['keep', 'recapture'], description: 'Renewal price carried by the number: keep it, or price it again under the new point of sale; required' })
  linePrices?: string;
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

export class CompleteTaskBodyDto {
  @ApiPropertyOptional()
  note?: string;

  @ApiPropertyOptional({ description: 'eSIM serial the provider handed back (required on an eSIM request)' })
  iccid?: string;

  @ApiPropertyOptional({ description: 'eSIM QR picture as a data URL (required on an eSIM request)', nullable: true })
  qr?: string | null;

  @ApiPropertyOptional({ description: 'New number (required on a number change)' })
  msisdn?: string;
}

export class ProviderEsimPriceBodyDto {
  @ApiPropertyOptional({ description: 'eSIM price in agorot, or null to use the company price', nullable: true, type: Number })
  price?: number | null;
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

export class TransferAccountBodyDto {
  @ApiPropertyOptional({ description: 'The new agent for a point of sale, the new main agent for an agent' })
  parentLogin?: string;

  @ApiPropertyOptional({ enum: ['keep', 'reset'], description: 'Custom prices and hidden packages on the moved account; required' })
  ownPrices?: string;

  @ApiPropertyOptional({ enum: ['keep', 'reset'], description: 'Operation stops on the moved account; required' })
  ownStops?: string;

  @ApiPropertyOptional({ enum: ['keep', 'reset'], description: 'Agent only, required for an agent: rows on its points of sale and its sell prices' })
  childPrices?: string;

  @ApiPropertyOptional({ enum: ['keep', 'reset'], description: 'Agent only, required for an agent: stops on its points of sale' })
  childStops?: string;

  @ApiPropertyOptional({ enum: ['keep', 'recapture'], description: 'Renewal prices carried by the moved numbers; required' })
  linePrices?: string;
}

export class SetAccountPasswordBodyDto {
  @ApiPropertyOptional()
  password?: string;
}
