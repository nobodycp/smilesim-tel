import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

class HealthOkDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

@ApiTags('health')
@Controller()
export class HealthController {
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthOkDto })
  health() {
    return { ok: true };
  }
}
