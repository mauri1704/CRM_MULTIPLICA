import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  currencyInput,
  currencyUpdate,
  type CurrencyInput,
  type CurrencyUpdate,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { CurrenciesService } from './currencies.service';

const listQuery = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@ApiTags('Monedas')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  /** Cualquier usuario autenticado: los formularios de productos y negociaciones las necesitan. */
  @Get()
  @ZodQuery(listQuery)
  list(@Query() query: z.infer<typeof listQuery>) {
    return this.currencies.list(query.includeInactive);
  }

  @Post()
  @RequirePermission('currencies', 'manage')
  @ZodBody(currencyInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: CurrencyInput,
  ) {
    return this.currencies.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('currencies', 'manage')
  @ZodBody(currencyUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: CurrencyUpdate,
  ) {
    return this.currencies.update(id, body, toActor(user, ip));
  }

  @Post(':id/base')
  @HttpCode(200)
  @RequirePermission('currencies', 'manage')
  setBase(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    return this.currencies.setBase(id, toActor(user, ip));
  }
}
