import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  currencyCode,
  decimalString,
  exchangeRateInput,
  exchangeRateUpdate,
  isoDate,
  type ExchangeRateInput,
  type ExchangeRateUpdate,
} from '@crm/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { CurrenciesService } from '../currencies/currencies.service';
import { ExchangeRatesService } from './exchange-rates.service';

export const rateListQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  currency: currencyCode.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const resolveQuery = z.object({
  from: currencyCode,
  to: currencyCode,
  date: isoDate,
  amount: decimalString().optional(),
});

@ApiTags('Tipos de cambio')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly rates: ExchangeRatesService,
    private readonly currencies: CurrenciesService,
  ) {}

  @Get()
  @RequirePermission('exchange_rates', 'view')
  @ZodQuery(rateListQuery)
  list(@Query() query: z.infer<typeof rateListQuery>) {
    return this.rates.list(query);
  }

  /**
   * Tasa aplicable para convertir `amount` de `from` a `to` en `date`, con la regla D-05.
   * Si no hay tasa válida responde `found: false`: el usuario debe registrar una.
   */
  @Get('resolve')
  @RequirePermission('exchange_rates', 'view')
  @ZodQuery(resolveQuery)
  async resolve(@Query() q: z.infer<typeof resolveQuery>) {
    const r = await this.rates.resolve(q.from, q.to, q.date);
    if (!r) {
      return {
        found: false,
        message: `No hay un tipo de cambio ${q.from}→${q.to} válido para el ${q.date}. Registre la tasa del día.`,
      };
    }
    const target = await this.currencies.findByCode(q.to);
    const converted =
      q.amount !== undefined
        ? new Prisma.Decimal(q.amount)
            .mul(r.rate)
            .toDecimalPlaces(target?.decimals ?? 2, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(target?.decimals ?? 2)
        : undefined;
    return { found: true, ...r, converted };
  }

  @Get(':id/history')
  @RequirePermission('exchange_rates', 'view')
  history(@Param('id', UuidPipe) id: string) {
    return this.rates.historyOf(id);
  }

  @Post()
  @RequirePermission('exchange_rates', 'manage')
  @ZodBody(exchangeRateInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: ExchangeRateInput,
  ) {
    return this.rates.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('exchange_rates', 'manage')
  @ZodBody(exchangeRateUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: ExchangeRateUpdate,
  ) {
    return this.rates.update(id, body, toActor(user, ip));
  }
}
