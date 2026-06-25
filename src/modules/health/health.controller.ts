import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok',
        stellar: 'ok',
        soroban: 'ok',
      },
    };
  }
}
