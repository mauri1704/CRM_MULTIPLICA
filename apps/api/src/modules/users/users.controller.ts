import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  catalogActiveInput,
  createUserInput,
  listQuery,
  setUserPasswordInput,
  updateUserInput,
  type CreateUserInput,
  type ListQuery,
  type SetUserPasswordInput,
  type UpdateUserInput,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { UsersService } from './users.service';

const usersQuery = listQuery.extend({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

@ApiTags('Usuarios')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users', 'view')
  @ZodQuery(usersQuery)
  list(@Query() query: ListQuery & { active?: boolean }) {
    return this.users.list(query);
  }

  /** Para selectores: cualquier usuario autenticado de la organización. */
  @Get('options')
  options() {
    return this.users.options();
  }

  @Get(':id')
  @RequirePermission('users', 'view')
  get(@Param('id', UuidPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('users', 'manage')
  @ZodBody(createUserInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: CreateUserInput,
  ) {
    return this.users.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('users', 'manage')
  @ZodBody(updateUserInput)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: UpdateUserInput,
  ) {
    return this.users.update(id, body, toActor(user, ip));
  }

  @Put(':id/active')
  @RequirePermission('users', 'manage')
  @ZodBody(catalogActiveInput)
  setActive(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: { active: boolean },
  ) {
    return this.users.setActive(id, body.active, toActor(user, ip));
  }

  @Put(':id/password')
  @RequirePermission('users', 'manage')
  @ZodBody(setUserPasswordInput)
  async setPassword(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: SetUserPasswordInput,
  ) {
    await this.users.setPassword(id, body.password, toActor(user, ip));
    return { ok: true };
  }
}
