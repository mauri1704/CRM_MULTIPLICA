import { access, constants } from 'node:fs/promises';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { Db } from '../../infra/db';
import { env } from '../../infra/env';

@ApiTags('Sistema')
@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  /** Vivo: el proceso responde y llega a la base. */
  @Public()
  @SkipThrottle()
  @Get()
  async health() {
    await this.db.client.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  /** Listo para recibir tráfico: base de datos y directorio de archivos. */
  @Public()
  @SkipThrottle()
  @Get('ready')
  async ready() {
    const checks: Record<string, 'ok' | 'fail'> = {};
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    try {
      await access(env().STORAGE_DIR, constants.W_OK);
      checks.storage = 'ok';
    } catch {
      checks.storage = 'fail';
    }
    const status = Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'fail';
    if (status === 'fail') throw new ServiceUnavailableException({ status, checks });
    return { status, checks };
  }
}
