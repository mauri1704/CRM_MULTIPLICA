import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  currencyCode,
  productInput,
  productUpdate,
  type ProductInput,
  type ProductUpdate,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { ProductsService } from './products.service';

export const productQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  currencyCode: currencyCode.optional(),
  active: z
    .enum(['true', 'false', 'all'])
    .default('true')
    .transform((v) => (v === 'all' ? undefined : v === 'true')),
  sort: z.enum(['name', 'sku', 'price', 'createdAt']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@ApiTags('Productos')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('products', 'view')
  @ZodQuery(productQuery)
  list(@Query() query: z.infer<typeof productQuery>) {
    return this.products.list(query);
  }

  @Get(':id')
  @RequirePermission('products', 'view')
  get(@Param('id', UuidPipe) id: string) {
    return this.products.get(id);
  }

  @Post()
  @RequirePermission('products', 'create')
  @ZodBody(productInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: ProductInput,
  ) {
    return this.products.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('products', 'edit')
  @ZodBody(productUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: ProductUpdate,
  ) {
    return this.products.update(id, body, toActor(user, ip));
  }

  @Delete(':id')
  @RequirePermission('products', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.products.remove(id, toActor(user, ip));
    return { ok: true };
  }
}
