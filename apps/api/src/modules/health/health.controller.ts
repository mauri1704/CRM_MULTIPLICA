import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { Db } from '../../infra/db';

@ApiTags('Sistema')
@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @SkipThrottle()
  @Get()
  async health() {
    await this.db.client.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
