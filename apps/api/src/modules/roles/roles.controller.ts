import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { roleInput, roleUpdate, type RoleInput, type RoleUpdate } from '@crm/shared';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody } from '../../common/zod';
import { RolesService } from './roles.service';

@ApiTags('Roles y permisos')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles', 'view')
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @RequirePermission('roles', 'view')
  get(@Param('id', UuidPipe) id: string) {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermission('roles', 'manage')
  @ZodBody(roleInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: RoleInput,
  ) {
    return this.roles.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('roles', 'manage')
  @ZodBody(roleUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: RoleUpdate,
  ) {
    return this.roles.update(id, body, toActor(user, ip));
  }

  @Delete(':id')
  @RequirePermission('roles', 'manage')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.roles.remove(id, toActor(user, ip));
    return { ok: true };
  }
}
