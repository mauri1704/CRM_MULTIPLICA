import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ENTITY_TYPES, can, type EntityType, type PermissionModule } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { forbidden, notFound } from '../../common/errors';
import { UuidPipe } from '../../common/uuid.pipe';
import { HistoryService } from './history.service';

/** Módulo cuyo permiso "ver" da acceso al historial de cada tipo de registro. */
const MODULE_BY_ENTITY: Partial<Record<EntityType, PermissionModule>> = {
  TEAM: 'teams',
  USER: 'users',
  ROLE: 'roles',
  PIPELINE: 'settings',
  STAGE: 'settings',
  CATALOG: 'settings',
  CUSTOM_FIELD: 'settings',
  ORGANIZATION: 'settings',
};

@ApiTags('Historial')
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get(':entityType/:entityId')
  async list(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId', UuidPipe) entityId: string,
  ) {
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) throw notFound();
    const module = MODULE_BY_ENTITY[entityType as EntityType];
    // Las entidades comerciales (fases 2+) validan el acceso al registro concreto en su propio módulo.
    if (!module) throw notFound();
    if (!can(user.permissions, module, 'view')) throw forbidden();
    return this.history.list(entityType as EntityType, entityId);
  }
}
