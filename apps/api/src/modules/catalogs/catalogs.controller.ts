import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CATALOG_KINDS, catalogActiveInput } from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { CatalogsService, isCatalogKind } from './catalogs.service';

const listCatalogQuery = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

function kindOf(kind: string) {
  if (!isCatalogKind(kind)) throw notFound('El catálogo');
  return kind;
}

/** Catálogos: /catalogs/{priorities|lead-sources|loss-reasons|document-types|economic-sectors|task-statuses} */
@ApiTags('Catálogos')
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  kinds() {
    return CATALOG_KINDS;
  }

  /** Cualquier usuario autenticado: los formularios necesitan los valores activos. */
  @Get(':kind')
  @ZodQuery(listCatalogQuery)
  list(@Param('kind') kind: string, @Query() query: z.infer<typeof listCatalogQuery>) {
    return this.catalogs.list(kindOf(kind), query.includeInactive);
  }

  /** El cuerpo se valida en el service con el esquema del catálogo correspondiente. */
  @Post(':kind')
  @RequirePermission('settings', 'manage')
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    return this.catalogs.create(kindOf(kind), body, toActor(user, ip));
  }

  @Patch(':kind/:id')
  @RequirePermission('settings', 'manage')
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('kind') kind: string,
    @Param('id', UuidPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.catalogs.update(kindOf(kind), id, body, toActor(user, ip));
  }

  @Put(':kind/:id/active')
  @RequirePermission('settings', 'manage')
  @ZodBody(catalogActiveInput)
  setActive(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('kind') kind: string,
    @Param('id', UuidPipe) id: string,
    @Body() body: { active: boolean },
  ) {
    return this.catalogs.setActive(kindOf(kind), id, body.active, toActor(user, ip));
  }
}
