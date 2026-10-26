import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listQuery,
  teamInput,
  teamUpdate,
  type ListQuery,
  type TeamInput,
  type TeamUpdate,
} from '@crm/shared';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { TeamsService } from './teams.service';

@ApiTags('Equipos')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** Cualquier usuario autenticado: los equipos se usan como filtro en listas y reportes. */
  @Get()
  @ZodQuery(listQuery)
  list(@Query() query: ListQuery) {
    return this.teams.list(query);
  }

  @Get(':id')
  get(@Param('id', UuidPipe) id: string) {
    return this.teams.get(id);
  }

  @Post()
  @RequirePermission('teams', 'manage')
  @ZodBody(teamInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: TeamInput,
  ) {
    return this.teams.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('teams', 'manage')
  @ZodBody(teamUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: TeamUpdate,
  ) {
    return this.teams.update(id, body, toActor(user, ip));
  }

  @Delete(':id')
  @RequirePermission('teams', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.teams.remove(id, toActor(user, ip));
    return { ok: true };
  }
}
