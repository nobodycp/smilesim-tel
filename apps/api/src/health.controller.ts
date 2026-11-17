import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

class HealthOkDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

@ApiTags('health')
@Controller()
export class HealthController {
  @Get('health')
  // A probe's answer is never kept, not even by the browser (speed plan PF.11).
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthOkDto })
  health() {
    return { ok: true };
  }
}
